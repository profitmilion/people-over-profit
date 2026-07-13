// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title POP33 Basic V1 Open/Locked Core
/// @notice Implements paid positions, deterministic pool allocation, withdrawal,
///         and the Open-to-Locked transition. Draws and claims are intentionally absent.
contract Pop33BasicV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ENTRY_PRICE = 33_000_000;
    uint256 public constant MAX_POSITIONS_PER_POOL = 100;
    uint256 public constant MAX_ACTIVE_POSITIONS_PER_USER = 10;
    uint256 public constant MAX_OPEN_POOLS = 10;
    uint256 public constant MAX_PAGE_SIZE = 100;

    enum PoolStatus {
        Open,
        Locked,
        Drawing,
        Claimable,
        Finished
    }

    struct Pool {
        uint256 id;
        PoolStatus status;
        uint256 activePositionCount;
        uint256 escrowedAmount;
        uint64 openedAt;
        uint64 lockedAt;
        uint64 drawInterval;
    }

    struct Position {
        uint256 id;
        uint256 poolId;
        address owner;
        uint64 joinedAt;
        bool active;
    }

    error InvalidPaymentToken();
    error PaymentTokenHasNoCode(address token);
    error PaymentTokenMetadataUnavailable(address token);
    error InvalidPaymentTokenDecimals(uint8 actualDecimals);
    error InvalidDrawInterval();
    error MaxActivePositionsReached(address user);
    error NoQualifyingPool(address user);
    error PoolDoesNotExist(uint256 poolId);
    error PoolNotOpen(uint256 poolId);
    error PositionDoesNotExist(uint256 positionId);
    error NotPositionOwner(uint256 positionId, address caller);
    error PositionAlreadyInactive(uint256 positionId);
    error IncorrectTokenAmountReceived(uint256 expected, uint256 received);
    error PageSizeTooLarge(uint256 requested, uint256 maximum);
    error OpenPoolNotIndexed(uint256 poolId);
    error ActivePositionNotIndexed(uint256 poolId, uint256 positionId);
    error ActivePositionIndexMismatch(uint256 poolId, uint256 expected, uint256 actual);

    event PoolCreated(uint256 indexed poolId, uint64 openedAt, uint64 drawInterval);
    event PositionJoined(
        uint256 indexed positionId,
        uint256 indexed poolId,
        address indexed user,
        uint256 amount,
        uint256 activePositionCount
    );
    event PositionWithdrawn(
        uint256 indexed positionId,
        uint256 indexed poolId,
        address indexed user,
        uint256 amount,
        uint256 activePositionCount
    );
    event PoolLocked(
        uint256 indexed poolId,
        uint64 lockedAt,
        uint64 drawInterval,
        uint256 activePositionCount,
        uint256 escrowedAmount
    );

    IERC20 public immutable paymentToken;
    uint64 public immutable DRAW_INTERVAL;

    uint256 public poolCount;
    uint256 public positionCount;
    uint256 public totalEscrowed;

    mapping(uint256 poolId => Pool pool) private _pools;
    mapping(uint256 positionId => Position position) private _positions;
    uint256[] private _openPoolIds;
    mapping(uint256 poolId => uint256[] positionIds) private _activePoolPositionIds;
    mapping(uint256 poolId => mapping(uint256 positionId => uint256 indexPlusOne))
        private _activePoolPositionIndexPlusOne;
    mapping(uint256 poolId => mapping(address user => uint256 positionId))
        private _activePositionByPoolAndUser;
    mapping(address user => uint256 count) public activePositionsByUser;

    constructor(IERC20 paymentToken_, uint64 drawInterval_) {
        address tokenAddress = address(paymentToken_);
        if (tokenAddress == address(0)) revert InvalidPaymentToken();
        if (tokenAddress.code.length == 0) revert PaymentTokenHasNoCode(tokenAddress);

        try IERC20Metadata(tokenAddress).decimals() returns (uint8 actualDecimals) {
            if (actualDecimals != 6) revert InvalidPaymentTokenDecimals(actualDecimals);
        } catch {
            revert PaymentTokenMetadataUnavailable(tokenAddress);
        }
        if (drawInterval_ == 0) revert InvalidDrawInterval();

        paymentToken = paymentToken_;
        DRAW_INTERVAL = drawInterval_;
        _createPool();
    }

    /// @notice Creates one paid position in the oldest qualifying open pool.
    /// @return newPositionId The globally unique position identifier.
    /// @return selectedPoolId The pool selected by the allocation algorithm.
    function join()
        external
        nonReentrant
        returns (uint256 newPositionId, uint256 selectedPoolId)
    {
        if (activePositionsByUser[msg.sender] >= MAX_ACTIVE_POSITIONS_PER_USER) {
            revert MaxActivePositionsReached(msg.sender);
        }

        selectedPoolId = _findOldestQualifyingPool(msg.sender);
        if (selectedPoolId == 0) {
            if (_openPoolIds.length >= MAX_OPEN_POOLS) revert NoQualifyingPool(msg.sender);
            selectedPoolId = _createPool();
        }

        Pool storage pool = _pools[selectedPoolId];
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(selectedPoolId);

        uint256 balanceBefore = paymentToken.balanceOf(address(this));
        newPositionId = ++positionCount;
        _positions[newPositionId] = Position({
            id: newPositionId,
            poolId: selectedPoolId,
            owner: msg.sender,
            joinedAt: uint64(block.timestamp),
            active: true
        });
        _activePoolPositionIds[selectedPoolId].push(newPositionId);
        _activePoolPositionIndexPlusOne[selectedPoolId][newPositionId] =
            _activePoolPositionIds[selectedPoolId].length;
        _activePositionByPoolAndUser[selectedPoolId][msg.sender] = newPositionId;

        pool.activePositionCount = _activePoolPositionIds[selectedPoolId].length;
        pool.escrowedAmount += ENTRY_PRICE;
        activePositionsByUser[msg.sender] += 1;
        totalEscrowed += ENTRY_PRICE;

        emit PositionJoined(
            newPositionId,
            selectedPoolId,
            msg.sender,
            ENTRY_PRICE,
            pool.activePositionCount
        );

        if (pool.activePositionCount == MAX_POSITIONS_PER_POOL) {
            uint256 activeSetLength = _activePoolPositionIds[selectedPoolId].length;
            if (activeSetLength != MAX_POSITIONS_PER_POOL) {
                revert ActivePositionIndexMismatch(
                    selectedPoolId,
                    MAX_POSITIONS_PER_POOL,
                    activeSetLength
                );
            }
            pool.status = PoolStatus.Locked;
            pool.lockedAt = uint64(block.timestamp);
            _removeOpenPool(selectedPoolId);
            emit PoolLocked(
                selectedPoolId,
                pool.lockedAt,
                pool.drawInterval,
                pool.activePositionCount,
                pool.escrowedAmount
            );
        }

        paymentToken.safeTransferFrom(msg.sender, address(this), ENTRY_PRICE);
        uint256 amountReceived = paymentToken.balanceOf(address(this)) - balanceBefore;
        if (amountReceived != ENTRY_PRICE) {
            revert IncorrectTokenAmountReceived(ENTRY_PRICE, amountReceived);
        }
    }

    /// @notice Removes and refunds the caller's active position from an open pool.
    function withdraw(uint256 positionId) external nonReentrant {
        Position storage position = _positions[positionId];
        if (position.id == 0) revert PositionDoesNotExist(positionId);
        if (position.owner != msg.sender) revert NotPositionOwner(positionId, msg.sender);
        if (!position.active) revert PositionAlreadyInactive(positionId);

        Pool storage pool = _pools[position.poolId];
        if (pool.status != PoolStatus.Open) revert PoolNotOpen(position.poolId);

        _removeActivePosition(position.poolId, positionId);
        position.active = false;
        _activePositionByPoolAndUser[position.poolId][msg.sender] = 0;
        pool.activePositionCount = _activePoolPositionIds[position.poolId].length;
        pool.escrowedAmount -= ENTRY_PRICE;
        activePositionsByUser[msg.sender] -= 1;
        totalEscrowed -= ENTRY_PRICE;

        emit PositionWithdrawn(
            positionId,
            position.poolId,
            msg.sender,
            ENTRY_PRICE,
            pool.activePositionCount
        );
        paymentToken.safeTransfer(msg.sender, ENTRY_PRICE);
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        _requirePool(poolId);
        return _pools[poolId];
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        if (_positions[positionId].id == 0) revert PositionDoesNotExist(positionId);
        return _positions[positionId];
    }

    function getActivePositionId(uint256 poolId, address user)
        external
        view
        returns (uint256)
    {
        _requirePool(poolId);
        return _activePositionByPoolAndUser[poolId][user];
    }

    function hasActivePosition(uint256 poolId, address user) external view returns (bool) {
        _requirePool(poolId);
        return _activePositionByPoolAndUser[poolId][user] != 0;
    }

    function openPoolCount() external view returns (uint256) {
        return _openPoolIds.length;
    }

    function getPoolActivePositionCount(uint256 poolId) external view returns (uint256) {
        _requirePool(poolId);
        return _activePoolPositionIds[poolId].length;
    }

    /// @notice Returns all currently open pool IDs, ordered from oldest to newest.
    /// @dev The result is bounded by MAX_OPEN_POOLS.
    function getOpenPoolIds() external view returns (uint256[] memory) {
        return _openPoolIds;
    }

    /// @notice Returns a bounded page of active position IDs for a pool.
    function getPoolActivePositionIds(uint256 poolId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory ids)
    {
        _requirePool(poolId);
        if (limit > MAX_PAGE_SIZE) revert PageSizeTooLarge(limit, MAX_PAGE_SIZE);

        uint256 length = _activePoolPositionIds[poolId].length;
        if (offset >= length || limit == 0) return new uint256[](0);

        uint256 end = offset + limit;
        if (end > length) end = length;
        ids = new uint256[](end - offset);
        for (uint256 index = offset; index < end; ++index) {
            ids[index - offset] = _activePoolPositionIds[poolId][index];
        }
    }

    /// @notice Returns the oldest open pool in which `user` has no active position.
    function findOldestQualifyingPool(address user) external view returns (uint256) {
        return _findOldestQualifyingPool(user);
    }

    function _findOldestQualifyingPool(address user) private view returns (uint256) {
        uint256 length = _openPoolIds.length;
        for (uint256 index; index < length; ++index) {
            uint256 poolId = _openPoolIds[index];
            Pool storage pool = _pools[poolId];
            if (
                pool.activePositionCount < MAX_POSITIONS_PER_POOL &&
                _activePositionByPoolAndUser[poolId][user] == 0
            ) {
                return poolId;
            }
        }
        return 0;
    }

    function _createPool() private returns (uint256 poolId) {
        poolId = ++poolCount;
        uint64 openedAt = uint64(block.timestamp);
        _pools[poolId] = Pool({
            id: poolId,
            status: PoolStatus.Open,
            activePositionCount: 0,
            escrowedAmount: 0,
            openedAt: openedAt,
            lockedAt: 0,
            drawInterval: DRAW_INTERVAL
        });
        _openPoolIds.push(poolId);
        emit PoolCreated(poolId, openedAt, DRAW_INTERVAL);
    }

    function _removeOpenPool(uint256 poolId) internal {
        uint256 length = _openPoolIds.length;
        for (uint256 index; index < length; ++index) {
            if (_openPoolIds[index] != poolId) continue;

            for (uint256 shiftIndex = index; shiftIndex + 1 < length; ++shiftIndex) {
                _openPoolIds[shiftIndex] = _openPoolIds[shiftIndex + 1];
            }
            _openPoolIds.pop();
            return;
        }
        revert OpenPoolNotIndexed(poolId);
    }

    function _removeActivePosition(uint256 poolId, uint256 positionId) private {
        uint256 indexPlusOne = _activePoolPositionIndexPlusOne[poolId][positionId];
        if (indexPlusOne == 0) revert ActivePositionNotIndexed(poolId, positionId);

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _activePoolPositionIds[poolId].length - 1;
        if (index != lastIndex) {
            uint256 movedPositionId = _activePoolPositionIds[poolId][lastIndex];
            _activePoolPositionIds[poolId][index] = movedPositionId;
            _activePoolPositionIndexPlusOne[poolId][movedPositionId] = index + 1;
        }

        _activePoolPositionIds[poolId].pop();
        delete _activePoolPositionIndexPlusOne[poolId][positionId];
    }

    function _requirePool(uint256 poolId) private view {
        if (_pools[poolId].id == 0) revert PoolDoesNotExist(poolId);
    }
}

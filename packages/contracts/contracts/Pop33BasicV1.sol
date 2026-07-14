// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title POP33 Basic V1
/// @notice Implements paid positions, deterministic pool allocation, withdrawal,
///         ten scheduled draw rounds, pull-based prizes, and the complete pool lifecycle.
/// @dev Winner selection is deliberately temporary and NOT production-safe. It uses
///      block attributes that validators and callers can influence. Replace it with a
///      verified randomness request/fulfillment flow before any production deployment.
contract Pop33BasicV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ENTRY_PRICE = 33_000_000;
    uint256 public constant MAX_POSITIONS_PER_POOL = 100;
    uint256 public constant MAX_ACTIVE_POSITIONS_PER_USER = 10;
    uint256 public constant MAX_OPEN_POOLS = 10;
    uint256 public constant MAX_PAGE_SIZE = 100;
    uint256 public constant DRAW_ROUNDS = 10;
    uint256 public constant PRIZE_PER_ROUND = 330_000_000;
    uint256 public constant TOTAL_PRIZE_AMOUNT = 3_300_000_000;

    enum PoolStatus {
        Open,
        Locked,
        Drawing,
        Claimable,
        Finished
    }

    enum RoundStatus {
        Pending,
        Finalized
    }

    struct Pool {
        uint256 id;
        PoolStatus status;
        uint256 activePositionCount;
        uint256 escrowedAmount;
        uint64 openedAt;
        uint64 lockedAt;
        uint64 drawInterval;
        uint256 entryPrice;
        uint256 prizePerRound;
        uint256 totalPrizeAmount;
        uint256 positionsPerPool;
        uint256 drawRoundCount;
        uint256 completedDrawRoundCount;
        uint256 claimedPrizeCount;
        uint256 assignedPrizeAmount;
        uint256 claimedPrizeAmount;
    }

    struct Position {
        uint256 id;
        uint256 poolId;
        address owner;
        uint64 joinedAt;
        bool active;
    }

    struct DrawRound {
        uint256 number;
        uint256 scheduledAt;
        uint256 executedAt;
        RoundStatus status;
        uint256 winningPositionId;
        address winner;
        uint256 prizeAmount;
        uint256 temporaryRequestId;
        bool claimed;
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
    error DrawCandidateNotIndexed(uint256 poolId, uint256 positionId);
    error DrawCandidateCountMismatch(uint256 poolId, uint256 expected, uint256 actual);
    error PoolNotDrawable(uint256 poolId, PoolStatus status);
    error InvalidDrawRoundNumber(uint256 poolId, uint256 roundNumber);
    error DrawRoundOutOfSequence(uint256 poolId, uint256 expected, uint256 actual);
    error DrawRoundAlreadyExecuted(uint256 poolId, uint256 roundNumber);
    error DrawRoundNotReady(
        uint256 poolId,
        uint256 roundNumber,
        uint256 scheduledAt,
        uint256 currentTimestamp
    );
    error DrawRoundNotFinalized(uint256 poolId, uint256 roundNumber);
    error WinningPositionAlreadySelected(uint256 poolId, uint256 positionId);
    error NotRoundWinner(uint256 poolId, uint256 roundNumber, address caller);
    error PrizeAlreadyClaimed(uint256 poolId, uint256 roundNumber);
    error PrizeAccountingMismatch(uint256 poolId, uint256 expected, uint256 actual);

    event PoolCreated(uint256 indexed poolId, uint64 openedAt, uint64 drawInterval);
    event PoolConfigurationSnapshotted(
        uint256 indexed poolId,
        uint256 entryPrice,
        uint256 positionsPerPool,
        uint256 drawRoundCount,
        uint256 prizePerRound,
        uint256 totalPrizeAmount,
        uint64 drawInterval
    );
    event PoolStatusChanged(
        uint256 indexed poolId,
        PoolStatus previousStatus,
        PoolStatus newStatus
    );
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
    event DrawRoundExecuted(
        uint256 indexed poolId,
        uint256 indexed roundNumber,
        uint256 indexed temporaryRequestId,
        uint256 scheduledAt,
        uint256 executedAt
    );
    event WinningPositionAssigned(
        uint256 indexed poolId,
        uint256 indexed roundNumber,
        uint256 indexed positionId,
        address winner,
        uint256 prizeAmount
    );
    event PrizeClaimed(
        uint256 indexed poolId,
        uint256 indexed roundNumber,
        uint256 indexed positionId,
        address winner,
        uint256 prizeAmount
    );

    IERC20 public immutable paymentToken;
    uint64 public immutable DRAW_INTERVAL;

    uint256 public poolCount;
    uint256 public positionCount;
    uint256 public totalEscrowed;
    uint256 public totalPrizesAssigned;
    uint256 public totalPrizesClaimed;
    uint256 public temporaryRequestCount;

    mapping(uint256 poolId => Pool pool) private _pools;
    mapping(uint256 positionId => Position position) private _positions;
    uint256[] private _openPoolIds;
    mapping(uint256 poolId => uint256[] positionIds) private _activePoolPositionIds;
    mapping(uint256 poolId => mapping(uint256 positionId => uint256 indexPlusOne))
        private _activePoolPositionIndexPlusOne;
    mapping(uint256 poolId => uint256[] positionIds) private _drawCandidatePositionIds;
    mapping(uint256 poolId => mapping(uint256 positionId => uint256 indexPlusOne))
        private _drawCandidatePositionIndexPlusOne;
    mapping(uint256 poolId => mapping(address user => uint256 positionId))
        private _activePositionByPoolAndUser;
    mapping(uint256 poolId => mapping(uint256 roundNumber => DrawRound drawRound))
        private _drawRounds;
    mapping(uint256 poolId => mapping(uint256 positionId => bool selected))
        public isWinningPosition;
    mapping(address user => uint256 count) public activePositionsByUser;
    mapping(address user => uint256 amount) public claimablePrizesByUser;

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
        _drawCandidatePositionIds[selectedPoolId].push(newPositionId);
        _drawCandidatePositionIndexPlusOne[selectedPoolId][newPositionId] =
            _drawCandidatePositionIds[selectedPoolId].length;
        _activePositionByPoolAndUser[selectedPoolId][msg.sender] = newPositionId;

        pool.activePositionCount = _activePoolPositionIds[selectedPoolId].length;
        pool.escrowedAmount += pool.entryPrice;
        activePositionsByUser[msg.sender] += 1;
        totalEscrowed += pool.entryPrice;

        emit PositionJoined(
            newPositionId,
            selectedPoolId,
            msg.sender,
            pool.entryPrice,
            pool.activePositionCount
        );

        if (pool.activePositionCount == pool.positionsPerPool) {
            uint256 activeSetLength = _activePoolPositionIds[selectedPoolId].length;
            if (activeSetLength != pool.positionsPerPool) {
                revert ActivePositionIndexMismatch(
                    selectedPoolId,
                    pool.positionsPerPool,
                    activeSetLength
                );
            }
            uint256 drawCandidateCount = _drawCandidatePositionIds[selectedPoolId].length;
            if (drawCandidateCount != pool.positionsPerPool) {
                revert DrawCandidateCountMismatch(
                    selectedPoolId,
                    pool.positionsPerPool,
                    drawCandidateCount
                );
            }
            _setPoolStatus(pool, PoolStatus.Locked);
            pool.lockedAt = uint64(block.timestamp);
            _initializeDrawRounds(pool);
            _removeOpenPool(selectedPoolId);
            emit PoolLocked(
                selectedPoolId,
                pool.lockedAt,
                pool.drawInterval,
                pool.activePositionCount,
                pool.escrowedAmount
            );
        }

        paymentToken.safeTransferFrom(msg.sender, address(this), pool.entryPrice);
        uint256 amountReceived = paymentToken.balanceOf(address(this)) - balanceBefore;
        if (amountReceived != pool.entryPrice) {
            revert IncorrectTokenAmountReceived(pool.entryPrice, amountReceived);
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
        _removeDrawCandidate(position.poolId, positionId);
        position.active = false;
        _activePositionByPoolAndUser[position.poolId][msg.sender] = 0;
        pool.activePositionCount = _activePoolPositionIds[position.poolId].length;
        pool.escrowedAmount -= pool.entryPrice;
        activePositionsByUser[msg.sender] -= 1;
        totalEscrowed -= pool.entryPrice;

        emit PositionWithdrawn(
            positionId,
            position.poolId,
            msg.sender,
            pool.entryPrice,
            pool.activePositionCount
        );
        paymentToken.safeTransfer(msg.sender, pool.entryPrice);
    }

    /// @notice Executes one eligible draw round using bounded, temporary winner selection.
    /// @dev This synchronous entropy construction is manipulable and MUST NOT be used in
    ///      production. It exists only to exercise the complete testnet lifecycle before
    ///      a verified randomness integration is selected.
    function executeDraw(uint256 poolId, uint256 roundNumber)
        external
        returns (uint256 winningPositionId)
    {
        _requirePool(poolId);
        Pool storage pool = _pools[poolId];
        if (pool.status != PoolStatus.Locked && pool.status != PoolStatus.Drawing) {
            revert PoolNotDrawable(poolId, pool.status);
        }
        if (roundNumber == 0 || roundNumber > pool.drawRoundCount) {
            revert InvalidDrawRoundNumber(poolId, roundNumber);
        }

        DrawRound storage drawRound = _drawRounds[poolId][roundNumber];
        if (drawRound.status == RoundStatus.Finalized) {
            revert DrawRoundAlreadyExecuted(poolId, roundNumber);
        }

        uint256 expectedRoundNumber = pool.completedDrawRoundCount + 1;
        if (roundNumber != expectedRoundNumber) {
            revert DrawRoundOutOfSequence(poolId, expectedRoundNumber, roundNumber);
        }
        if (block.timestamp < drawRound.scheduledAt) {
            revert DrawRoundNotReady(
                poolId,
                roundNumber,
                drawRound.scheduledAt,
                block.timestamp
            );
        }

        uint256 expectedCandidateCount = pool.positionsPerPool - pool.completedDrawRoundCount;
        uint256 candidateCount = _drawCandidatePositionIds[poolId].length;
        if (candidateCount != expectedCandidateCount) {
            revert DrawCandidateCountMismatch(poolId, expectedCandidateCount, candidateCount);
        }

        if (pool.status == PoolStatus.Locked) {
            _setPoolStatus(pool, PoolStatus.Drawing);
        }

        uint256 temporaryRequestId = ++temporaryRequestCount;
        uint256 temporaryEntropy = uint256(
            keccak256(
                abi.encode(
                    block.prevrandao,
                    blockhash(block.number - 1),
                    block.timestamp,
                    msg.sender,
                    address(this),
                    block.chainid,
                    poolId,
                    roundNumber,
                    temporaryRequestId
                )
            )
        );
        uint256 selectedIndex = temporaryEntropy % candidateCount;
        winningPositionId = _drawCandidatePositionIds[poolId][selectedIndex];
        if (isWinningPosition[poolId][winningPositionId]) {
            revert WinningPositionAlreadySelected(poolId, winningPositionId);
        }

        Position storage winningPosition = _positions[winningPositionId];
        _removeDrawCandidate(poolId, winningPositionId);
        isWinningPosition[poolId][winningPositionId] = true;

        drawRound.executedAt = block.timestamp;
        drawRound.status = RoundStatus.Finalized;
        drawRound.winningPositionId = winningPositionId;
        drawRound.winner = winningPosition.owner;
        drawRound.temporaryRequestId = temporaryRequestId;

        pool.completedDrawRoundCount += 1;
        pool.assignedPrizeAmount += drawRound.prizeAmount;
        totalPrizesAssigned += drawRound.prizeAmount;
        claimablePrizesByUser[winningPosition.owner] += drawRound.prizeAmount;

        emit DrawRoundExecuted(
            poolId,
            roundNumber,
            temporaryRequestId,
            drawRound.scheduledAt,
            drawRound.executedAt
        );
        emit WinningPositionAssigned(
            poolId,
            roundNumber,
            winningPositionId,
            winningPosition.owner,
            drawRound.prizeAmount
        );

        if (pool.completedDrawRoundCount == pool.drawRoundCount) {
            if (pool.assignedPrizeAmount != pool.totalPrizeAmount) {
                revert PrizeAccountingMismatch(
                    poolId,
                    pool.totalPrizeAmount,
                    pool.assignedPrizeAmount
                );
            }
            _setPoolStatus(pool, PoolStatus.Claimable);
        }
    }

    /// @notice Claims one finalized round prize for its winning position owner.
    /// @dev Uses checks-effects-interactions and a reentrancy guard. The last outstanding
    ///      claim transitions the pool to Finished and atomically releases its positions.
    function claim(uint256 poolId, uint256 roundNumber) external nonReentrant {
        _requirePool(poolId);
        Pool storage pool = _pools[poolId];
        if (roundNumber == 0 || roundNumber > pool.drawRoundCount) {
            revert InvalidDrawRoundNumber(poolId, roundNumber);
        }

        DrawRound storage drawRound = _drawRounds[poolId][roundNumber];
        if (drawRound.status != RoundStatus.Finalized) {
            revert DrawRoundNotFinalized(poolId, roundNumber);
        }
        if (drawRound.winner != msg.sender) {
            revert NotRoundWinner(poolId, roundNumber, msg.sender);
        }
        if (drawRound.claimed) revert PrizeAlreadyClaimed(poolId, roundNumber);

        uint256 prizeAmount = drawRound.prizeAmount;
        drawRound.claimed = true;
        pool.claimedPrizeCount += 1;
        pool.claimedPrizeAmount += prizeAmount;
        pool.escrowedAmount -= prizeAmount;
        totalEscrowed -= prizeAmount;
        totalPrizesClaimed += prizeAmount;
        claimablePrizesByUser[msg.sender] -= prizeAmount;

        if (pool.claimedPrizeCount == pool.drawRoundCount) {
            if (
                pool.completedDrawRoundCount != pool.drawRoundCount ||
                pool.claimedPrizeAmount != pool.totalPrizeAmount
            ) {
                revert PrizeAccountingMismatch(
                    poolId,
                    pool.totalPrizeAmount,
                    pool.claimedPrizeAmount
                );
            }
            _setPoolStatus(pool, PoolStatus.Finished);
            _releaseFinishedPoolPositions(pool);
        }

        emit PrizeClaimed(
            poolId,
            roundNumber,
            drawRound.winningPositionId,
            msg.sender,
            prizeAmount
        );
        paymentToken.safeTransfer(msg.sender, prizeAmount);
    }

    function getPool(uint256 poolId) external view returns (Pool memory) {
        _requirePool(poolId);
        return _pools[poolId];
    }

    function getPosition(uint256 positionId) external view returns (Position memory) {
        if (_positions[positionId].id == 0) revert PositionDoesNotExist(positionId);
        return _positions[positionId];
    }

    function getDrawRound(uint256 poolId, uint256 roundNumber)
        external
        view
        returns (DrawRound memory)
    {
        _requirePool(poolId);
        Pool storage pool = _pools[poolId];
        if (roundNumber == 0 || roundNumber > pool.drawRoundCount) {
            revert InvalidDrawRoundNumber(poolId, roundNumber);
        }
        return _drawRounds[poolId][roundNumber];
    }

    function getPoolDrawCandidateCount(uint256 poolId) external view returns (uint256) {
        _requirePool(poolId);
        return _drawCandidatePositionIds[poolId].length;
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
                pool.activePositionCount < pool.positionsPerPool &&
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
            drawInterval: DRAW_INTERVAL,
            entryPrice: ENTRY_PRICE,
            prizePerRound: PRIZE_PER_ROUND,
            totalPrizeAmount: TOTAL_PRIZE_AMOUNT,
            positionsPerPool: MAX_POSITIONS_PER_POOL,
            drawRoundCount: DRAW_ROUNDS,
            completedDrawRoundCount: 0,
            claimedPrizeCount: 0,
            assignedPrizeAmount: 0,
            claimedPrizeAmount: 0
        });
        _openPoolIds.push(poolId);
        emit PoolCreated(poolId, openedAt, DRAW_INTERVAL);
        emit PoolConfigurationSnapshotted(
            poolId,
            ENTRY_PRICE,
            MAX_POSITIONS_PER_POOL,
            DRAW_ROUNDS,
            PRIZE_PER_ROUND,
            TOTAL_PRIZE_AMOUNT,
            DRAW_INTERVAL
        );
    }

    function _initializeDrawRounds(Pool storage pool) private {
        for (uint256 roundNumber = 1; roundNumber <= pool.drawRoundCount; ++roundNumber) {
            _drawRounds[pool.id][roundNumber] = DrawRound({
                number: roundNumber,
                scheduledAt: uint256(pool.lockedAt) + roundNumber * pool.drawInterval,
                executedAt: 0,
                status: RoundStatus.Pending,
                winningPositionId: 0,
                winner: address(0),
                prizeAmount: pool.prizePerRound,
                temporaryRequestId: 0,
                claimed: false
            });
        }
    }

    function _setPoolStatus(Pool storage pool, PoolStatus newStatus) private {
        PoolStatus previousStatus = pool.status;
        pool.status = newStatus;
        emit PoolStatusChanged(pool.id, previousStatus, newStatus);
    }

    function _releaseFinishedPoolPositions(Pool storage pool) private {
        uint256 length = _activePoolPositionIds[pool.id].length;
        if (length != pool.positionsPerPool) {
            revert ActivePositionIndexMismatch(pool.id, pool.positionsPerPool, length);
        }

        for (uint256 index; index < length; ++index) {
            uint256 positionId = _activePoolPositionIds[pool.id][index];
            Position storage position = _positions[positionId];
            position.active = false;
            activePositionsByUser[position.owner] -= 1;
            delete _activePositionByPoolAndUser[pool.id][position.owner];
            delete _activePoolPositionIndexPlusOne[pool.id][positionId];
            delete _drawCandidatePositionIndexPlusOne[pool.id][positionId];
        }

        delete _activePoolPositionIds[pool.id];
        delete _drawCandidatePositionIds[pool.id];
        pool.activePositionCount = 0;
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

    function _removeDrawCandidate(uint256 poolId, uint256 positionId) private {
        uint256 indexPlusOne = _drawCandidatePositionIndexPlusOne[poolId][positionId];
        if (indexPlusOne == 0) revert DrawCandidateNotIndexed(poolId, positionId);

        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = _drawCandidatePositionIds[poolId].length - 1;
        if (index != lastIndex) {
            uint256 movedPositionId = _drawCandidatePositionIds[poolId][lastIndex];
            _drawCandidatePositionIds[poolId][index] = movedPositionId;
            _drawCandidatePositionIndexPlusOne[poolId][movedPositionId] = index + 1;
        }

        _drawCandidatePositionIds[poolId].pop();
        delete _drawCandidatePositionIndexPlusOne[poolId][positionId];
    }

    function _requirePool(uint256 poolId) private view {
        if (_pools[poolId].id == 0) revert PoolDoesNotExist(poolId);
    }
}

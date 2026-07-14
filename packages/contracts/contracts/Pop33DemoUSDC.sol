// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title POP33 Demo USD
/// @notice Faucet token for POP33 demonstrations on test networks only.
/// @dev This is not USDC, is not affiliated with Circle, has no monetary value,
///      and must never be used as a production or real-value asset.
contract Pop33DemoUSDC is ERC20 {
    uint256 public immutable DRIP_AMOUNT;
    uint256 public immutable DRIP_COOLDOWN;

    mapping(address account => uint256 timestamp) public nextDripAt;

    error InvalidDripAmount();
    error InvalidDripCooldown();
    error DripCooldownActive(address account, uint256 nextAvailableAt);

    event DemoTokensDripped(
        address indexed recipient,
        uint256 amount,
        uint256 nextAvailableAt
    );

    constructor(uint256 dripAmount_, uint256 dripCooldown_)
        ERC20("POP33 Demo USD", "dUSDC")
    {
        if (dripAmount_ == 0) revert InvalidDripAmount();
        if (dripCooldown_ == 0) revert InvalidDripCooldown();

        DRIP_AMOUNT = dripAmount_;
        DRIP_COOLDOWN = dripCooldown_;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints one fixed testnet-only allocation to the caller after cooldown.
    /// @return nextAvailableAt Timestamp at which this address may call `drip` again.
    function drip() external returns (uint256 nextAvailableAt) {
        uint256 currentNextDripAt = nextDripAt[msg.sender];
        if (block.timestamp < currentNextDripAt) {
            revert DripCooldownActive(msg.sender, currentNextDripAt);
        }

        nextAvailableAt = block.timestamp + DRIP_COOLDOWN;
        nextDripAt[msg.sender] = nextAvailableAt;
        _mint(msg.sender, DRIP_AMOUNT);

        emit DemoTokensDripped(msg.sender, DRIP_AMOUNT, nextAvailableAt);
    }
}

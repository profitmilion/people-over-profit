// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title POP33 Test USDC
/// @notice Unrestricted mintable token for local automated tests only.
/// @dev This contract is not production USDC and must never be used as a real asset.
contract MockUSDC is ERC20 {
    constructor() ERC20("POP33 Test USDC - NOT FOR PRODUCTION", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mints test units without access control for deterministic tests.
    function mint(address recipient, uint256 amount) external {
        _mint(recipient, amount);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pop33BasicV1} from "../Pop33BasicV1.sol";

/// @notice Test-only harness for exercising internal open-pool index behavior.
/// @dev Must never be used as a production deployment artifact.
contract Pop33BasicV1Harness is Pop33BasicV1 {
    constructor(IERC20 paymentToken_, uint64 drawInterval_, uint256 positionsPerPool_)
        Pop33BasicV1(paymentToken_, drawInterval_, positionsPerPool_)
    {}

    function harnessRemoveOpenPool(uint256 poolId) external {
        _removeOpenPool(poolId);
    }
}

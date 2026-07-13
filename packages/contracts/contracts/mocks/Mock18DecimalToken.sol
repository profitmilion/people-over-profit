// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only standard ERC-20 with the wrong decimals for POP33.
contract Mock18DecimalToken is ERC20 {
    constructor() ERC20("POP33 Wrong Decimals Test Token", "WRONG18") {}
}

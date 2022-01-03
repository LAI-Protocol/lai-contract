// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../LAO/LAOStaking.sol";


contract LAOStakingTester is LAOStaking {
    function requireCallerIsTroveManager() external view {
        _requireCallerIsTroveManager();
    }
}

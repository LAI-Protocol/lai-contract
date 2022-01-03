// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Interfaces/ILAOStaking.sol";


contract LAOStakingScript is CheckContract {
    ILAOStaking immutable LAOStaking;

    constructor(address _laoStakingAddress) public {
        checkContract(_laoStakingAddress);
        LAOStaking = ILAOStaking(_laoStakingAddress);
    }

    function stake(uint _LAOamount) external {
        LAOStaking.stake(_LAOamount);
    }
}

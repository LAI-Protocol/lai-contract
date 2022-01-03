// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Interfaces/ILAIToken.sol";

contract LAITokenCaller {
    ILAIToken LAI;

    function setLAI(ILAIToken _LAI) external {
        LAI = _LAI;
    }

    function laiMint(address _account, uint _amount) external {
        LAI.mint(_account, _amount);
    }

    function laiBurn(address _account, uint _amount) external {
        LAI.burn(_account, _amount);
    }

    function laiSendToPool(address _sender,  address _poolAddress, uint256 _amount) external {
        LAI.sendToPool(_sender, _poolAddress, _amount);
    }

    function laiReturnFromPool(address _poolAddress, address _receiver, uint256 _amount ) external {
        LAI.returnFromPool(_poolAddress, _receiver, _amount);
    }
}

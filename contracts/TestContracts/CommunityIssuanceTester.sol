// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../LAO/CommunityIssuance.sol";

contract CommunityIssuanceTester is CommunityIssuance {
    function obtainLAO(uint _amount) external {
        laoToken.transfer(msg.sender, _amount);
    }

    function getCumulativeIssuanceFraction() external view returns (uint) {
       return _getCumulativeIssuanceFraction();
    }

    function unprotectedIssueLAO() external returns (uint) {
        // No checks on caller address
       
        uint latestTotalLAOIssued = LAOSupplyCap.mul(_getCumulativeIssuanceFraction()).div(DECIMAL_PRECISION);
        uint issuance = latestTotalLAOIssued.sub(totalLAOIssued);
      
        totalLAOIssued = latestTotalLAOIssued;
        return issuance;
    }
}

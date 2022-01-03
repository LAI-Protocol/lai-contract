// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ICommunityIssuance { 
    
    // --- Events ---
    
    event LAOTokenAddressSet(address _laoTokenAddress);
    event StabilityPoolAddressSet(address _stabilityPoolAddress);
    event TotalLAOIssuedUpdated(uint _totalLAOIssued);

    // --- Functions ---

    function setAddresses(address _laoTokenAddress, address _stabilityPoolAddress) external;

    function issueLAO() external returns (uint);

    function sendLAO(address _account, uint _LAOamount) external;
}

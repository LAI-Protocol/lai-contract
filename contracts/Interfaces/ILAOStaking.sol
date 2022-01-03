// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

interface ILAOStaking {

    // --- Events --
    
    event LAOTokenAddressSet(address _laoTokenAddress);
    event LAITokenAddressSet(address _laiTokenAddress);
    event TroveManagerAddressSet(address _troveManager);
    event BorrowerOperationsAddressSet(address _borrowerOperationsAddress);
    event ActivePoolAddressSet(address _activePoolAddress);

    event StakeChanged(address indexed staker, uint newStake);
    event StakingGainsWithdrawn(address indexed staker, uint LAIGain, uint ETHGain);
    event F_ETHUpdated(uint _F_ETH);
    event F_LAIUpdated(uint _F_LAI);
    event TotalLAOStakedUpdated(uint _totalLAOStaked);
    event EtherSent(address _account, uint _amount);
    event StakerSnapshotsUpdated(address _staker, uint _F_ETH, uint _F_LAI);

    // --- Functions ---

    function setAddresses
    (
        address _laoTokenAddress,
        address _laiTokenAddress,
        address _troveManagerAddress, 
        address _borrowerOperationsAddress,
        address _activePoolAddress
    )  external;

    function stake(uint _LAOamount) external;

    function unstake(uint _LAOamount) external;

    function increaseF_ETH(uint _ETHFee) external; 

    function increaseF_LAI(uint _LAOFee) external;

    function getPendingETHGain(address _user) external view returns (uint);

    function getPendingLAIGain(address _user) external view returns (uint);
}

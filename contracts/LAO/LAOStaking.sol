// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/BaseMath.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Dependencies/CheckContract.sol";
import "../Dependencies/console.sol";
import "../Interfaces/ILAOToken.sol";
import "../Interfaces/ILAOStaking.sol";
import "../Dependencies/LiquityMath.sol";
import "../Interfaces/ILAIToken.sol";

contract LAOStaking is ILAOStaking, Ownable, CheckContract, BaseMath {
    using SafeMath for uint;

    // --- Data ---
    string constant public NAME = "LAOStaking";

    mapping( address => uint) public stakes;
    uint public totalLAOStaked;

    uint public F_ETH;  // Running sum of ETH fees per-LAO-staked
    uint public F_LAI; // Running sum of LAO fees per-LAO-staked

    // User snapshots of F_ETH and F_LAI, taken at the point at which their latest deposit was made
    mapping (address => Snapshot) public snapshots; 

    struct Snapshot {
        uint F_ETH_Snapshot;
        uint F_LAI_Snapshot;
    }
    
    ILAOToken public laoToken;
    ILAIToken public laiToken;

    address public troveManagerAddress;
    address public borrowerOperationsAddress;
    address public activePoolAddress;

    // --- Events ---

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
    ) 
        external 
        onlyOwner 
        override 
    {
        checkContract(_laoTokenAddress);
        checkContract(_laiTokenAddress);
        checkContract(_troveManagerAddress);
        checkContract(_borrowerOperationsAddress);
        checkContract(_activePoolAddress);

        laoToken = ILAOToken(_laoTokenAddress);
        laiToken = ILAIToken(_laiTokenAddress);
        troveManagerAddress = _troveManagerAddress;
        borrowerOperationsAddress = _borrowerOperationsAddress;
        activePoolAddress = _activePoolAddress;

        emit LAOTokenAddressSet(_laoTokenAddress);
        emit LAOTokenAddressSet(_laiTokenAddress);
        emit TroveManagerAddressSet(_troveManagerAddress);
        emit BorrowerOperationsAddressSet(_borrowerOperationsAddress);
        emit ActivePoolAddressSet(_activePoolAddress);

        _renounceOwnership();
    }

    // If caller has a pre-existing stake, send any accumulated ETH and LAI gains to them.
    function stake(uint _LAOamount) external override {
        _requireNonZeroAmount(_LAOamount);

        uint currentStake = stakes[msg.sender];

        uint ETHGain;
        uint LAIGain;
        // Grab any accumulated ETH and LAI gains from the current stake
        if (currentStake != 0) {
            ETHGain = _getPendingETHGain(msg.sender);
            LAIGain = _getPendingLAIGain(msg.sender);
        }
    
       _updateUserSnapshots(msg.sender);

        uint newStake = currentStake.add(_LAOamount);

        // Increase user’s stake and total LAO staked
        stakes[msg.sender] = newStake;
        totalLAOStaked = totalLAOStaked.add(_LAOamount);
        emit TotalLAOStakedUpdated(totalLAOStaked);

        // Transfer LAO from caller to this contract
        laoToken.sendToLAOStaking(msg.sender, _LAOamount);

        emit StakeChanged(msg.sender, newStake);
        emit StakingGainsWithdrawn(msg.sender, LAIGain, ETHGain);

         // Send accumulated LAI and ETH gains to the caller
        if (currentStake != 0) {
            laiToken.transfer(msg.sender, LAIGain);
            _sendETHGainToUser(ETHGain);
        }
    }

    // Unstake the LAO and send the it back to the caller, along with their accumulated LAI & ETH gains.
    // If requested amount > stake, send their entire stake.
    function unstake(uint _LAOamount) external override {
        uint currentStake = stakes[msg.sender];
        _requireUserHasStake(currentStake);

        // Grab any accumulated ETH and LAI gains from the current stake
        uint ETHGain = _getPendingETHGain(msg.sender);
        uint LAIGain = _getPendingLAIGain(msg.sender);
        
        _updateUserSnapshots(msg.sender);

        if (_LAOamount > 0) {
            uint LAOToWithdraw = LiquityMath._min(_LAOamount, currentStake);

            uint newStake = currentStake.sub(LAOToWithdraw);

            // Decrease user's stake and total LAO staked
            stakes[msg.sender] = newStake;
            totalLAOStaked = totalLAOStaked.sub(LAOToWithdraw);
            emit TotalLAOStakedUpdated(totalLAOStaked);

            // Transfer unstaked LAO to user
            laoToken.transfer(msg.sender, LAOToWithdraw);

            emit StakeChanged(msg.sender, newStake);
        }

        emit StakingGainsWithdrawn(msg.sender, LAIGain, ETHGain);

        // Send accumulated LAI and ETH gains to the caller
        laiToken.transfer(msg.sender, LAIGain);
        _sendETHGainToUser(ETHGain);
    }

    // --- Reward-per-unit-staked increase functions. Called by Liquity core contracts ---

    function increaseF_ETH(uint _ETHFee) external override {
        _requireCallerIsTroveManager();
        uint ETHFeePerLAOStaked;
     
        if (totalLAOStaked > 0) {ETHFeePerLAOStaked = _ETHFee.mul(DECIMAL_PRECISION).div(totalLAOStaked);}

        F_ETH = F_ETH.add(ETHFeePerLAOStaked);
        emit F_ETHUpdated(F_ETH);
    }

    function increaseF_LAI(uint _LAIFee) external override {
        _requireCallerIsBorrowerOperations();
        uint LAIFeePerLAOStaked;
        
        if (totalLAOStaked > 0) {LAIFeePerLAOStaked = _LAIFee.mul(DECIMAL_PRECISION).div(totalLAOStaked);}
        
        F_LAI = F_LAI.add(LAIFeePerLAOStaked);
        emit F_LAIUpdated(F_LAI);
    }

    // --- Pending reward functions ---

    function getPendingETHGain(address _user) external view override returns (uint) {
        return _getPendingETHGain(_user);
    }

    function _getPendingETHGain(address _user) internal view returns (uint) {
        uint F_ETH_Snapshot = snapshots[_user].F_ETH_Snapshot;
        uint ETHGain = stakes[_user].mul(F_ETH.sub(F_ETH_Snapshot)).div(DECIMAL_PRECISION);
        return ETHGain;
    }

    function getPendingLAIGain(address _user) external view override returns (uint) {
        return _getPendingLAIGain(_user);
    }

    function _getPendingLAIGain(address _user) internal view returns (uint) {
        uint F_LAI_Snapshot = snapshots[_user].F_LAI_Snapshot;
        uint LAIGain = stakes[_user].mul(F_LAI.sub(F_LAI_Snapshot)).div(DECIMAL_PRECISION);
        return LAIGain;
    }

    // --- Internal helper functions ---

    function _updateUserSnapshots(address _user) internal {
        snapshots[_user].F_ETH_Snapshot = F_ETH;
        snapshots[_user].F_LAI_Snapshot = F_LAI;
        emit StakerSnapshotsUpdated(_user, F_ETH, F_LAI);
    }

    function _sendETHGainToUser(uint ETHGain) internal {
        emit EtherSent(msg.sender, ETHGain);
        (bool success, ) = msg.sender.call{value: ETHGain}("");
        require(success, "LAOStaking: Failed to send accumulated ETHGain");
    }

    // --- 'require' functions ---

    function _requireCallerIsTroveManager() internal view {
        require(msg.sender == troveManagerAddress, "LAOStaking: caller is not TroveM");
    }

    function _requireCallerIsBorrowerOperations() internal view {
        require(msg.sender == borrowerOperationsAddress, "LAOStaking: caller is not BorrowerOps");
    }

     function _requireCallerIsActivePool() internal view {
        require(msg.sender == activePoolAddress, "LAOStaking: caller is not ActivePool");
    }

    function _requireUserHasStake(uint currentStake) internal pure {  
        require(currentStake > 0, 'LAOStaking: User must have a non-zero stake');
    }

    function _requireNonZeroAmount(uint _amount) internal pure {
        require(_amount > 0, 'LAOStaking: Amount must be non-zero');
    }

    receive() external payable {
        _requireCallerIsActivePool();
    }
}

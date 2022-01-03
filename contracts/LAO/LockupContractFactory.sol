// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/CheckContract.sol";
import "../Dependencies/SafeMath.sol";
import "../Dependencies/Ownable.sol";
import "../Interfaces/ILockupContractFactory.sol";
import "./LockupContract.sol";
import "../Dependencies/console.sol";

/*
* The LockupContractFactory deploys LockupContracts - its main purpose is to keep a registry of valid deployed 
* LockupContracts. 
* 
* This registry is checked by LAOToken when the Liquity deployer attempts to transfer LAO tokens. During the first year
* since system deployment, the Liquity deployer is only allowed to transfer LAO to valid LockupContracts that have been
* deployed by and recorded in the LockupContractFactory. This ensures the deployer's LAO can't be traded or staked in the
* first year, and can only be sent to a verified LockupContract which unlocks at least one year after system deployment.
*
* LockupContracts can of course be deployed directly, but only those deployed through and recorded in the LockupContractFactory 
* will be considered "valid" by LAOToken. This is a convenient way to verify that the target address is a genuine
* LockupContract.
*/

contract LockupContractFactory is ILockupContractFactory, Ownable, CheckContract {
    using SafeMath for uint;

    // --- Data ---
    string constant public NAME = "LockupContractFactory";

    uint constant public SECONDS_IN_ONE_YEAR = 31536000;

    address public laoTokenAddress;
    
    mapping (address => address) public lockupContractToDeployer;

    // --- Events ---

    event LAOTokenAddressSet(address _laoTokenAddress);
    event LockupContractDeployedThroughFactory(address _lockupContractAddress, address _beneficiary, uint _unlockTime, address _deployer);

    // --- Functions ---

    function setLAOTokenAddress(address _laoTokenAddress) external override onlyOwner {
        checkContract(_laoTokenAddress);

        laoTokenAddress = _laoTokenAddress;
        emit LAOTokenAddressSet(_laoTokenAddress);

        _renounceOwnership();
    }

    function deployLockupContract(address _beneficiary, uint _unlockTime) external override {
        address laoTokenAddressCached = laoTokenAddress;
        _requireLAOAddressIsSet(laoTokenAddressCached);
        LockupContract lockupContract = new LockupContract(
                                                        laoTokenAddressCached,
                                                        _beneficiary, 
                                                        _unlockTime);

        lockupContractToDeployer[address(lockupContract)] = msg.sender;
        emit LockupContractDeployedThroughFactory(address(lockupContract), _beneficiary, _unlockTime, msg.sender);
    }

    function isRegisteredLockup(address _contractAddress) public view override returns (bool) {
        return lockupContractToDeployer[_contractAddress] != address(0);
    }

    // --- 'require'  functions ---
    function _requireLAOAddressIsSet(address _laoTokenAddress) internal pure {
        require(_laoTokenAddress != address(0), "LCF: LAO Address is not set");
    }
}

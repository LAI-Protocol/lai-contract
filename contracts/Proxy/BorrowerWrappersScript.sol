// SPDX-License-Identifier: MIT

pragma solidity 0.6.11;

import "../Dependencies/SafeMath.sol";
import "../Dependencies/LiquityMath.sol";
import "../Dependencies/IERC20.sol";
import "../Interfaces/IBorrowerOperations.sol";
import "../Interfaces/ITroveManager.sol";
import "../Interfaces/IStabilityPool.sol";
import "../Interfaces/IPriceFeed.sol";
import "../Interfaces/ILAOStaking.sol";
import "./BorrowerOperationsScript.sol";
import "./ETHTransferScript.sol";
import "./LAOStakingScript.sol";
import "../Dependencies/console.sol";


contract BorrowerWrappersScript is BorrowerOperationsScript, ETHTransferScript, LAOStakingScript {
    using SafeMath for uint;

    string constant public NAME = "BorrowerWrappersScript";

    ITroveManager immutable troveManager;
    IStabilityPool immutable stabilityPool;
    IPriceFeed immutable priceFeed;
    IERC20 immutable laiToken;
    IERC20 immutable laoToken;
    ILAOStaking immutable laoStaking;

    constructor(
        address _borrowerOperationsAddress,
        address _troveManagerAddress,
        address _laoStakingAddress
    )
        BorrowerOperationsScript(IBorrowerOperations(_borrowerOperationsAddress))
        LAOStakingScript(_laoStakingAddress)
        public
    {
        checkContract(_troveManagerAddress);
        ITroveManager troveManagerCached = ITroveManager(_troveManagerAddress);
        troveManager = troveManagerCached;

        IStabilityPool stabilityPoolCached = troveManagerCached.stabilityPool();
        checkContract(address(stabilityPoolCached));
        stabilityPool = stabilityPoolCached;

        IPriceFeed priceFeedCached = troveManagerCached.priceFeed();
        checkContract(address(priceFeedCached));
        priceFeed = priceFeedCached;

        address laiTokenCached = address(troveManagerCached.laiToken());
        checkContract(laiTokenCached);
        laiToken = IERC20(laiTokenCached);

        address laoTokenCached = address(troveManagerCached.laoToken());
        checkContract(laoTokenCached);
        laoToken = IERC20(laoTokenCached);

        ILAOStaking laoStakingCached = troveManagerCached.laoStaking();
        require(_laoStakingAddress == address(laoStakingCached), "BorrowerWrappersScript: Wrong LAOStaking address");
        laoStaking = laoStakingCached;
    }

    function claimCollateralAndOpenTrove(uint _maxFee, uint _LAIAmount, address _upperHint, address _lowerHint) external payable {
        uint balanceBefore = address(this).balance;

        // Claim collateral
        borrowerOperations.claimCollateral();

        uint balanceAfter = address(this).balance;

        // already checked in CollSurplusPool
        assert(balanceAfter > balanceBefore);

        uint totalCollateral = balanceAfter.sub(balanceBefore).add(msg.value);

        // Open trove with obtained collateral, plus collateral sent by user
        borrowerOperations.openTrove{ value: totalCollateral }(_maxFee, _LAIAmount, _upperHint, _lowerHint);
    }

    function claimSPRewardsAndRecycle(uint _maxFee, address _upperHint, address _lowerHint) external {
        uint collBalanceBefore = address(this).balance;
        uint laoBalanceBefore = laoToken.balanceOf(address(this));

        // Claim rewards
        stabilityPool.withdrawFromSP(0);

        uint collBalanceAfter = address(this).balance;
        uint laoBalanceAfter = laoToken.balanceOf(address(this));
        uint claimedCollateral = collBalanceAfter.sub(collBalanceBefore);

        // Add claimed ETH to trove, get more LAI and stake it into the Stability Pool
        if (claimedCollateral > 0) {
            _requireUserHasTrove(address(this));
            uint LAIAmount = _getNetLAIAmount(claimedCollateral);
            borrowerOperations.adjustTrove{ value: claimedCollateral }(_maxFee, 0, LAIAmount, true, _upperHint, _lowerHint);
            // Provide withdrawn LAI to Stability Pool
            if (LAIAmount > 0) {
                stabilityPool.provideToSP(LAIAmount, address(0));
            }
        }

        // Stake claimed LAO
        uint claimedLAO = laoBalanceAfter.sub(laoBalanceBefore);
        if (claimedLAO > 0) {
            laoStaking.stake(claimedLAO);
        }
    }

    function claimStakingGainsAndRecycle(uint _maxFee, address _upperHint, address _lowerHint) external {
        uint collBalanceBefore = address(this).balance;
        uint laiBalanceBefore = laiToken.balanceOf(address(this));
        uint laoBalanceBefore = laoToken.balanceOf(address(this));

        // Claim gains
        laoStaking.unstake(0);

        uint gainedCollateral = address(this).balance.sub(collBalanceBefore); // stack too deep issues :'(
        uint gainedLAI = laiToken.balanceOf(address(this)).sub(laiBalanceBefore);

        uint netLAIAmount;
        // Top up trove and get more LAI, keeping ICR constant
        if (gainedCollateral > 0) {
            _requireUserHasTrove(address(this));
            netLAIAmount = _getNetLAIAmount(gainedCollateral);
            borrowerOperations.adjustTrove{ value: gainedCollateral }(_maxFee, 0, netLAIAmount, true, _upperHint, _lowerHint);
        }

        uint totalLAI = gainedLAI.add(netLAIAmount);
        if (totalLAI > 0) {
            stabilityPool.provideToSP(totalLAI, address(0));

            // Providing to Stability Pool also triggers LAO claim, so stake it if any
            uint laoBalanceAfter = laoToken.balanceOf(address(this));
            uint claimedLAO = laoBalanceAfter.sub(laoBalanceBefore);
            if (claimedLAO > 0) {
                laoStaking.stake(claimedLAO);
            }
        }

    }

    function _getNetLAIAmount(uint _collateral) internal returns (uint) {
        uint price = priceFeed.fetchPrice();
        uint ICR = troveManager.getCurrentICR(address(this), price);

        uint LAIAmount = _collateral.mul(price).div(ICR);
        uint borrowingRate = troveManager.getBorrowingRateWithDecay();
        uint netDebt = LAIAmount.mul(LiquityMath.DECIMAL_PRECISION).div(LiquityMath.DECIMAL_PRECISION.add(borrowingRate));

        return netDebt;
    }

    function _requireUserHasTrove(address _depositor) internal view {
        require(troveManager.getTroveStatus(_depositor) == 1, "BorrowerWrappersScript: caller must have an active trove");
    }
}

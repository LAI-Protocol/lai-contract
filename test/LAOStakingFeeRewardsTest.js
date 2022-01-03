const Decimal = require("decimal.js");
const deploymentHelper = require("../utils/deploymentHelpers.js")
const { BNConverter } = require("../utils/BNConverter.js")
const testHelpers = require("../utils/testHelpers.js")

const LAOStakingTester = artifacts.require('LAOStakingTester')
const TroveManagerTester = artifacts.require("TroveManagerTester")
const NonPayable = artifacts.require("./NonPayable.sol")

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const toBN = th.toBN
const ZERO = th.toBN('0')

/* NOTE: These tests do not test for specific ETH and LAI gain values. They only test that the 
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake. 
 *
 * Specific ETH/LAI gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 * 
 */ 

contract('LAOStaking revenue share tests', async accounts => {

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  const [owner, A, B, C, D, E, F, G, whale] = accounts;

  let priceFeed
  let laiToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let laoStaking
  let laoToken

  let contracts

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployLAITokenTester(contracts)
    const LAOContracts = await deploymentHelper.deployLAOTesterContractsHardhat(bountyAddress, lpRewardsAddress, multisig)
    
    await deploymentHelper.connectLAOContracts(LAOContracts)
    await deploymentHelper.connectCoreContracts(contracts, LAOContracts)
    await deploymentHelper.connectLAOContractsToCore(LAOContracts, contracts)

    nonPayable = await NonPayable.new() 
    priceFeed = contracts.priceFeedTestnet
    laiToken = contracts.laiToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers

    laoToken = LAOContracts.laoToken
    laoStaking = LAOContracts.laoStaking
  })

  it('stake(): reverts if amount is zero', async () => {
    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A lao bal: ${await laoToken.balanceOf(A)}`)

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await assertRevert(laoStaking.stake(0, {from: A}), "LAOStaking: Amount must be non-zero")
  })

  it("ETH fee per LAO staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // console.log(`A lao bal: ${await laoToken.balanceOf(A)}`)

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(100, 18), {from: A})

    // Check ETH fee per unit staked is zero
    const F_ETH_Before = await laoStaking.F_ETH()
    assert.equal(F_ETH_Before, '0')

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // Check ETH fee per unit staked has increased by correct amount
    const F_ETH_After = await laoStaking.F_ETH()

    // Expect fee per unit staked = fee/100, since there is 100 LAI totalStaked
    const expected_F_ETH_After = emittedETHFee.div(toBN('100')) 

    assert.isTrue(expected_F_ETH_After.eq(F_ETH_After))
  })

  it("ETH fee per LAO staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // Check ETH fee per unit staked is zero
    const F_ETH_Before = await laoStaking.F_ETH()
    assert.equal(F_ETH_Before, '0')

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN((await th.getEmittedRedemptionValues(redemptionTx))[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))

    // Check ETH fee per unit staked has not increased 
    const F_ETH_After = await laoStaking.F_ETH()
    assert.equal(F_ETH_After, '0')
  })

  it("LAI fee per LAO staked increases when a redemption fee is triggered and totalStakes > 0", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(100, 18), {from: A})

    // Check LAI fee per unit staked is zero
    const F_LAI_Before = await laoStaking.F_ETH()
    assert.equal(F_LAI_Before, '0')

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawLAI(th._100pct, dec(27, 18), D, D, {from: D})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee = toBN(th.getLAIFeeFromLAIBorrowingEvent(tx))
    assert.isTrue(emittedLAIFee.gt(toBN('0')))
    
    // Check LAI fee per unit staked has increased by correct amount
    const F_LAI_After = await laoStaking.F_LAI()

    // Expect fee per unit staked = fee/100, since there is 100 LAI totalStaked
    const expected_F_LAI_After = emittedLAIFee.div(toBN('100')) 

    assert.isTrue(expected_F_LAI_After.eq(F_LAI_After))
  })

  it("LAI fee per LAO staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // Check LAI fee per unit staked is zero
    const F_LAI_Before = await laoStaking.F_ETH()
    assert.equal(F_LAI_Before, '0')

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // Check base rate is now non-zero
    const baseRate = await troveManager.baseRate()
    assert.isTrue(baseRate.gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawLAI(th._100pct, dec(27, 18), D, D, {from: D})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee = toBN(th.getLAIFeeFromLAIBorrowingEvent(tx))
    assert.isTrue(emittedLAIFee.gt(toBN('0')))
    
    // Check LAI fee per unit staked did not increase, is still zero
    const F_LAI_After = await laoStaking.F_LAI()
    assert.equal(F_LAI_After, '0')
  })

  it("LAO Staking: A single staker earns all ETH and LAO fees that occur", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(100, 18), {from: A})

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await laiToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await laiToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawLAI(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_1 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedLAIFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawLAI(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_2 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedLAIFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalLAIGain = emittedLAIFee_1.add(emittedLAIFee_2)

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_Before = toBN(await laiToken.balanceOf(A))

    // A un-stakes
    await laoStaking.unstake(dec(100, 18), {from: A, gasPrice: 0})

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_After = toBN(await laiToken.balanceOf(A))


    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_LAIGain = A_LAIBalance_After.sub(A_LAIBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalLAIGain, A_LAIGain), 1000)
  })

  it("stake(): Top-up sends out all accumulated ETH and LAI gains to the staker", async () => { 
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await laiToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await laiToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawLAI(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_1 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedLAIFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawLAI(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_2 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedLAIFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalLAIGain = emittedLAIFee_1.add(emittedLAIFee_2)

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_Before = toBN(await laiToken.balanceOf(A))

    // A tops up
    await laoStaking.stake(dec(50, 18), {from: A, gasPrice: 0})

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_After = toBN(await laiToken.balanceOf(A))

    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_LAIGain = A_LAIBalance_After.sub(A_LAIBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalLAIGain, A_LAIGain), 1000)
  })

  it("getPendingETHGain(): Returns the staker's correct pending ETH gain", async () => { 
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await laiToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await laiToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)

    const A_ETHGain = await laoStaking.getPendingETHGain(A)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
  })

  it("getPendingLAIGain(): Returns the staker's correct pending LAI gain", async () => { 
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A
    await laoToken.transfer(A, dec(100, 18), {from: multisig})

    // A makes stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoStaking.stake(dec(50, 18), {from: A})

    const B_BalBeforeREdemption = await laiToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    
    const B_BalAfterRedemption = await laiToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeREdemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const C_BalBeforeREdemption = await laiToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    
    const C_BalAfterRedemption = await laiToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))
 
     // check ETH fee 2 emitted in event is non-zero
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawLAI(th._100pct, dec(104, 18), D, D, {from: D})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_1 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedLAIFee_1.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawLAI(th._100pct, dec(17, 18), B, B, {from: B})
    
    // Check LAI fee value in event is non-zero
    const emittedLAIFee_2 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedLAIFee_2.gt(toBN('0')))

    const expectedTotalLAIGain = emittedLAIFee_1.add(emittedLAIFee_2)
    const A_LAIGain = await laoStaking.getPendingLAIGain(A)

    assert.isAtMost(th.getDifference(expectedTotalLAIGain, A_LAIGain), 1000)
  })

  // - multi depositors, several rewards
  it("LAO Staking: Multiple stakers earn the correct share of all ETH and LAO fees, based on their stake size", async () => {
    await openTrove({ extraLAIAmount: toBN(dec(10000, 18)), ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: E } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: F } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: G } })

    // FF time one year so owner can transfer LAO
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A, B, C
    await laoToken.transfer(A, dec(100, 18), {from: multisig})
    await laoToken.transfer(B, dec(200, 18), {from: multisig})
    await laoToken.transfer(C, dec(300, 18), {from: multisig})

    // A, B, C make stake
    await laoToken.approve(laoStaking.address, dec(100, 18), {from: A})
    await laoToken.approve(laoStaking.address, dec(200, 18), {from: B})
    await laoToken.approve(laoStaking.address, dec(300, 18), {from: C})
    await laoStaking.stake(dec(100, 18), {from: A})
    await laoStaking.stake(dec(200, 18), {from: B})
    await laoStaking.stake(dec(300, 18), {from: C})

    // Confirm staking contract holds 600 LAO
    // console.log(`lao staking LAO bal: ${await laoToken.balanceOf(laoStaking.address)}`)
    assert.equal(await laoToken.balanceOf(laoStaking.address), dec(600, 18))
    assert.equal(await laoStaking.totalLAOStaked(), dec(600, 18))

    // F redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(F, contracts, dec(45, 18))
    const emittedETHFee_1 = toBN((await th.getEmittedRedemptionValues(redemptionTx_1))[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

     // G redeems
     const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(G, contracts, dec(197, 18))
     const emittedETHFee_2 = toBN((await th.getEmittedRedemptionValues(redemptionTx_2))[3])
     assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    // F draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawLAI(th._100pct, dec(104, 18), F, F, {from: F})
    const emittedLAIFee_1 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedLAIFee_1.gt(toBN('0')))

    // G draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawLAI(th._100pct, dec(17, 18), G, G, {from: G})
    const emittedLAIFee_2 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedLAIFee_2.gt(toBN('0')))

    // D obtains LAO from owner and makes a stake
    await laoToken.transfer(D, dec(50, 18), {from: multisig})
    await laoToken.approve(laoStaking.address, dec(50, 18), {from: D})
    await laoStaking.stake(dec(50, 18), {from: D})

    // Confirm staking contract holds 650 LAO
    assert.equal(await laoToken.balanceOf(laoStaking.address), dec(650, 18))
    assert.equal(await laoStaking.totalLAOStaked(), dec(650, 18))

     // G redeems
     const redemptionTx_3 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(197, 18))
     const emittedETHFee_3 = toBN((await th.getEmittedRedemptionValues(redemptionTx_3))[3])
     assert.isTrue(emittedETHFee_3.gt(toBN('0')))

     // G draws debt
    const borrowingTx_3 = await borrowerOperations.withdrawLAI(th._100pct, dec(17, 18), G, G, {from: G})
    const emittedLAIFee_3 = toBN(th.getLAIFeeFromLAIBorrowingEvent(borrowingTx_3))
    assert.isTrue(emittedLAIFee_3.gt(toBN('0')))
     
    /*  
    Expected rewards:

    A_ETH: (100* ETHFee_1)/600 + (100* ETHFee_2)/600 + (100*ETH_Fee_3)/650
    B_ETH: (200* ETHFee_1)/600 + (200* ETHFee_2)/600 + (200*ETH_Fee_3)/650
    C_ETH: (300* ETHFee_1)/600 + (300* ETHFee_2)/600 + (300*ETH_Fee_3)/650
    D_ETH:                                             (100*ETH_Fee_3)/650

    A_LAI: (100*LAIFee_1 )/600 + (100* LAIFee_2)/600 + (100*LAIFee_3)/650
    B_LAI: (200* LAIFee_1)/600 + (200* LAIFee_2)/600 + (200*LAIFee_3)/650
    C_LAI: (300* LAIFee_1)/600 + (300* LAIFee_2)/600 + (300*LAIFee_3)/650
    D_LAI:                                               (100*LAIFee_3)/650
    */

    // Expected ETH gains
    const expectedETHGain_A = toBN('100').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_B = toBN('200').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_C = toBN('300').mul(emittedETHFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedETHFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedETHFee_3).div( toBN('650')))

    const expectedETHGain_D = toBN('50').mul(emittedETHFee_3).div( toBN('650'))

    // Expected LAI gains:
    const expectedLAIGain_A = toBN('100').mul(emittedLAIFee_1).div( toBN('600'))
                            .add(toBN('100').mul(emittedLAIFee_2).div( toBN('600')))
                            .add(toBN('100').mul(emittedLAIFee_3).div( toBN('650')))

    const expectedLAIGain_B = toBN('200').mul(emittedLAIFee_1).div( toBN('600'))
                            .add(toBN('200').mul(emittedLAIFee_2).div( toBN('600')))
                            .add(toBN('200').mul(emittedLAIFee_3).div( toBN('650')))

    const expectedLAIGain_C = toBN('300').mul(emittedLAIFee_1).div( toBN('600'))
                            .add(toBN('300').mul(emittedLAIFee_2).div( toBN('600')))
                            .add(toBN('300').mul(emittedLAIFee_3).div( toBN('650')))
    
    const expectedLAIGain_D = toBN('50').mul(emittedLAIFee_3).div( toBN('650'))


    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_Before = toBN(await laiToken.balanceOf(A))
    const B_ETHBalance_Before = toBN(await web3.eth.getBalance(B))
    const B_LAIBalance_Before = toBN(await laiToken.balanceOf(B))
    const C_ETHBalance_Before = toBN(await web3.eth.getBalance(C))
    const C_LAIBalance_Before = toBN(await laiToken.balanceOf(C))
    const D_ETHBalance_Before = toBN(await web3.eth.getBalance(D))
    const D_LAIBalance_Before = toBN(await laiToken.balanceOf(D))

    // A-D un-stake
    const unstake_A = await laoStaking.unstake(dec(100, 18), {from: A, gasPrice: 0})
    const unstake_B = await laoStaking.unstake(dec(200, 18), {from: B, gasPrice: 0})
    const unstake_C = await laoStaking.unstake(dec(400, 18), {from: C, gasPrice: 0})
    const unstake_D = await laoStaking.unstake(dec(50, 18), {from: D, gasPrice: 0})

    // Confirm all depositors could withdraw

    //Confirm pool Size is now 0
    assert.equal((await laoToken.balanceOf(laoStaking.address)), '0')
    assert.equal((await laoStaking.totalLAOStaked()), '0')

    // Get A-D ETH and LAI balances
    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_LAIBalance_After = toBN(await laiToken.balanceOf(A))
    const B_ETHBalance_After = toBN(await web3.eth.getBalance(B))
    const B_LAIBalance_After = toBN(await laiToken.balanceOf(B))
    const C_ETHBalance_After = toBN(await web3.eth.getBalance(C))
    const C_LAIBalance_After = toBN(await laiToken.balanceOf(C))
    const D_ETHBalance_After = toBN(await web3.eth.getBalance(D))
    const D_LAIBalance_After = toBN(await laiToken.balanceOf(D))

    // Get ETH and LAI gains
    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_LAIGain = A_LAIBalance_After.sub(A_LAIBalance_Before)
    const B_ETHGain = B_ETHBalance_After.sub(B_ETHBalance_Before)
    const B_LAIGain = B_LAIBalance_After.sub(B_LAIBalance_Before)
    const C_ETHGain = C_ETHBalance_After.sub(C_ETHBalance_Before)
    const C_LAIGain = C_LAIBalance_After.sub(C_LAIBalance_Before)
    const D_ETHGain = D_ETHBalance_After.sub(D_ETHBalance_Before)
    const D_LAIGain = D_LAIBalance_After.sub(D_LAIBalance_Before)

    // Check gains match expected amounts
    assert.isAtMost(th.getDifference(expectedETHGain_A, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedLAIGain_A, A_LAIGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_B, B_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedLAIGain_B, B_LAIGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_C, C_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedLAIGain_C, C_LAIGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_D, D_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedLAIGain_D, D_LAIGain), 1000)
  })
 
  it("unstake(): reverts if caller has ETH gains and can't receive ETH",  async () => {
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: whale } })  
    await openTrove({ extraLAIAmount: toBN(dec(20000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: A } })
    await openTrove({ extraLAIAmount: toBN(dec(30000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: B } })
    await openTrove({ extraLAIAmount: toBN(dec(40000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: C } })
    await openTrove({ extraLAIAmount: toBN(dec(50000, 18)), ICR: toBN(dec(2, 18)), extraParams: { from: D } })

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers LAO to staker A and the non-payable proxy
    await laoToken.transfer(A, dec(100, 18), {from: multisig})
    await laoToken.transfer(nonPayable.address, dec(100, 18), {from: multisig})

    //  A makes stake
    const A_stakeTx = await laoStaking.stake(dec(100, 18), {from: A})
    assert.isTrue(A_stakeTx.receipt.status)

    //  A tells proxy to make a stake
    const proxystakeTxData = await th.getTransactionData('stake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 LAO
    await nonPayable.forward(laoStaking.address, proxystakeTxData, {from: A})


    // B makes a redemption, creating ETH gain for proxy
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18))
    
    const proxy_ETHGain = await laoStaking.getPendingETHGain(nonPayable.address)
    assert.isTrue(proxy_ETHGain.gt(toBN('0')))

    // Expect this tx to revert: stake() tries to send nonPayable proxy's accumulated ETH gain (albeit 0),
    //  A tells proxy to unstake
    const proxyUnStakeTxData = await th.getTransactionData('unstake(uint256)', ['0x56bc75e2d63100000'])  // proxy stakes 100 LAO
    const proxyUnstakeTxPromise = nonPayable.forward(laoStaking.address, proxyUnStakeTxData, {from: A})
   
    // but nonPayable proxy can not accept ETH - therefore stake() reverts.
    await assertRevert(proxyUnstakeTxPromise)
  })

  it("receive(): reverts when it receives ETH from an address that is not the Active Pool",  async () => { 
    const ethSendTxPromise1 = web3.eth.sendTransaction({to: laoStaking.address, from: A, value: dec(1, 'ether')})
    const ethSendTxPromise2 = web3.eth.sendTransaction({to: laoStaking.address, from: owner, value: dec(1, 'ether')})

    await assertRevert(ethSendTxPromise1)
    await assertRevert(ethSendTxPromise2)
  })

  it("unstake(): reverts if user has no stake",  async () => {  
    const unstakeTxPromise1 = laoStaking.unstake(1, {from: A})
    const unstakeTxPromise2 = laoStaking.unstake(1, {from: owner})

    await assertRevert(unstakeTxPromise1)
    await assertRevert(unstakeTxPromise2)
  })

  it('Test requireCallerIsTroveManager', async () => {
    const laoStakingTester = await LAOStakingTester.new()
    await assertRevert(laoStakingTester.requireCallerIsTroveManager(), 'LAOStaking: caller is not TroveM')
  })
})

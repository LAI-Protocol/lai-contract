const deploymentHelper = require("../utils/deploymentHelpers.js")

contract('Deployment script - Sets correct contract addresses dependencies after deployment', async accounts => {
  const [owner] = accounts;

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)
  
  let priceFeed
  let laiToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let defaultPool
  let functionCaller
  let borrowerOperations
  let laoStaking
  let laoToken
  let communityIssuance
  let lockupContractFactory

  before(async () => {
    const coreContracts = await deploymentHelper.deployLiquityCore()
    const LAOContracts = await deploymentHelper.deployLAOContracts(bountyAddress, lpRewardsAddress, multisig)

    priceFeed = coreContracts.priceFeedTestnet
    laiToken = coreContracts.laiToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    activePool = coreContracts.activePool
    stabilityPool = coreContracts.stabilityPool
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations

    laoStaking = LAOContracts.laoStaking
    laoToken = LAOContracts.laoToken
    communityIssuance = LAOContracts.communityIssuance
    lockupContractFactory = LAOContracts.lockupContractFactory

    await deploymentHelper.connectLAOContracts(LAOContracts)
    await deploymentHelper.connectCoreContracts(coreContracts, LAOContracts)
    await deploymentHelper.connectLAOContractsToCore(LAOContracts, coreContracts)
  })

  it('Sets the correct PriceFeed address in TroveManager', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await troveManager.priceFeed()

    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  it('Sets the correct LAIToken address in TroveManager', async () => {
    const laiTokenAddress = laiToken.address

    const recordedClvTokenAddress = await troveManager.laiToken()

    assert.equal(laiTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct SortedTroves address in TroveManager', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await troveManager.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct BorrowerOperations address in TroveManager', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ActivePool in TroveM
  it('Sets the correct ActivePool address in TroveManager', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddresss = await troveManager.activePool()

    assert.equal(activePoolAddress, recordedActivePoolAddresss)
  })

  // DefaultPool in TroveM
  it('Sets the correct DefaultPool address in TroveManager', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddresss = await troveManager.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddresss)
  })

  // StabilityPool in TroveM
  it('Sets the correct StabilityPool address in TroveManager', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddresss = await troveManager.stabilityPool()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddresss)
  })

  // LAO Staking in TroveM
  it('Sets the correct LAOStaking address in TroveManager', async () => {
    const laoStakingAddress = laoStaking.address

    const recordedLAOStakingAddress = await troveManager.laoStaking()
    assert.equal(laoStakingAddress, recordedLAOStakingAddress)
  })

  // Active Pool

  it('Sets the correct StabilityPool address in ActivePool', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await activePool.stabilityPoolAddress()

    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })

  it('Sets the correct DefaultPool address in ActivePool', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await activePool.defaultPoolAddress()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  it('Sets the correct BorrowerOperations address in ActivePool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct TroveManager address in ActivePool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await activePool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Stability Pool

  it('Sets the correct ActivePool address in StabilityPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await stabilityPool.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct BorrowerOperations address in StabilityPool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct LAIToken address in StabilityPool', async () => {
    const laiTokenAddress = laiToken.address

    const recordedClvTokenAddress = await stabilityPool.laiToken()

    assert.equal(laiTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct TroveManager address in StabilityPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await stabilityPool.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Default Pool

  it('Sets the correct TroveManager address in DefaultPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct ActivePool address in DefaultPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await defaultPool.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct TroveManager address in SortedTroves', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct BorrowerOperations address in SortedTroves', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sortedTroves.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  //--- BorrowerOperations ---

  // TroveManager in BO
  it('Sets the correct TroveManager address in BorrowerOperations', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await borrowerOperations.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // setPriceFeed in BO
  it('Sets the correct PriceFeed address in BorrowerOperations', async () => {
    const priceFeedAddress = priceFeed.address

    const recordedPriceFeedAddress = await borrowerOperations.priceFeed()
    assert.equal(priceFeedAddress, recordedPriceFeedAddress)
  })

  // setSortedTroves in BO
  it('Sets the correct SortedTroves address in BorrowerOperations', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  // setActivePool in BO
  it('Sets the correct ActivePool address in BorrowerOperations', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await borrowerOperations.activePool()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // setDefaultPool in BO
  it('Sets the correct DefaultPool address in BorrowerOperations', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await borrowerOperations.defaultPool()
    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  // LAO Staking in BO
  it('Sets the correct LAOStaking address in BorrowerOperations', async () => {
    const laoStakingAddress = laoStaking.address

    const recordedLAOStakingAddress = await borrowerOperations.laoStakingAddress()
    assert.equal(laoStakingAddress, recordedLAOStakingAddress)
  })


  // --- LAO Staking ---

  // Sets LAOToken in LAOStaking
  it('Sets the correct LAOToken address in LAOStaking', async () => {
    const laoTokenAddress = laoToken.address

    const recordedLAOTokenAddress = await laoStaking.laoToken()
    assert.equal(laoTokenAddress, recordedLAOTokenAddress)
  })

  // Sets ActivePool in LAOStaking
  it('Sets the correct ActivePool address in LAOStaking', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await laoStaking.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // Sets LAIToken in LAOStaking
  it('Sets the correct ActivePool address in LAOStaking', async () => {
    const laiTokenAddress = laiToken.address

    const recordedLAITokenAddress = await laoStaking.laiToken()
    assert.equal(laiTokenAddress, recordedLAITokenAddress)
  })

  // Sets TroveManager in LAOStaking
  it('Sets the correct ActivePool address in LAOStaking', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await laoStaking.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Sets BorrowerOperations in LAOStaking
  it('Sets the correct BorrowerOperations address in LAOStaking', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await laoStaking.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ---  LAOToken ---

  // Sets CI in LAOToken
  it('Sets the correct CommunityIssuance address in LAOToken', async () => {
    const communityIssuanceAddress = communityIssuance.address

    const recordedcommunityIssuanceAddress = await laoToken.communityIssuanceAddress()
    assert.equal(communityIssuanceAddress, recordedcommunityIssuanceAddress)
  })

  // Sets LAOStaking in LAOToken
  it('Sets the correct LAOStaking address in LAOToken', async () => {
    const laoStakingAddress = laoStaking.address

    const recordedLAOStakingAddress =  await laoToken.laoStakingAddress()
    assert.equal(laoStakingAddress, recordedLAOStakingAddress)
  })

  // Sets LCF in LAOToken
  it('Sets the correct LockupContractFactory address in LAOToken', async () => {
    const LCFAddress = lockupContractFactory.address

    const recordedLCFAddress =  await laoToken.lockupContractFactory()
    assert.equal(LCFAddress, recordedLCFAddress)
  })

  // --- LCF  ---

  // Sets LAOToken in LockupContractFactory
  it('Sets the correct LAOToken address in LockupContractFactory', async () => {
    const laoTokenAddress = laoToken.address

    const recordedLAOTokenAddress = await lockupContractFactory.laoTokenAddress()
    assert.equal(laoTokenAddress, recordedLAOTokenAddress)
  })

  // --- CI ---

  // Sets LAOToken in CommunityIssuance
  it('Sets the correct LAOToken address in CommunityIssuance', async () => {
    const laoTokenAddress = laoToken.address

    const recordedLAOTokenAddress = await communityIssuance.laoToken()
    assert.equal(laoTokenAddress, recordedLAOTokenAddress)
  })

  it('Sets the correct StabilityPool address in CommunityIssuance', async () => {
    const stabilityPoolAddress = stabilityPool.address

    const recordedStabilityPoolAddress = await communityIssuance.stabilityPoolAddress()
    assert.equal(stabilityPoolAddress, recordedStabilityPoolAddress)
  })
})

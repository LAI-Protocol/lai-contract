const deploymentHelper = require("../../utils/deploymentHelpers.js")
const testHelpers = require("../../utils/testHelpers.js")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")


const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const assertRevert = th.assertRevert
const toBN = th.toBN
const dec = th.dec

contract('Deploying the LAO contracts: LCF, CI, LAOStaking, and LAOToken ', async accounts => {
  const [liquityAG, A, B] = accounts;
  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let LAOContracts

  const oneMillion = toBN(1000000)
  const digits = toBN(1e18)
  const thirtyTwo = toBN(32)
  const expectedCISupplyCap = thirtyTwo.mul(oneMillion).mul(digits)

  beforeEach(async () => {
    // Deploy all contracts from the first account
    LAOContracts = await deploymentHelper.deployLAOContracts(bountyAddress, lpRewardsAddress, multisig)
    await deploymentHelper.connectLAOContracts(LAOContracts)

    laoStaking = LAOContracts.laoStaking
    laoToken = LAOContracts.laoToken
    communityIssuance = LAOContracts.communityIssuance
    lockupContractFactory = LAOContracts.lockupContractFactory

    //LAO Staking and CommunityIssuance have not yet had their setters called, so are not yet
    // connected to the rest of the system
  })


  describe('CommunityIssuance deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await communityIssuance.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })

  describe('LAOStaking deployment', async accounts => {
    it("Stores the deployer's address", async () => {
      const storedDeployerAddress = await laoStaking.owner()

      assert.equal(liquityAG, storedDeployerAddress)
    })
  })

  describe('LAOToken deployment', async accounts => {
    it("Stores the multisig's address", async () => {
      const storedMultisigAddress = await laoToken.multisigAddress()

      assert.equal(multisig, storedMultisigAddress)
    })

    it("Stores the CommunityIssuance address", async () => {
      const storedCIAddress = await laoToken.communityIssuanceAddress()

      assert.equal(communityIssuance.address, storedCIAddress)
    })

    it("Stores the LockupContractFactory address", async () => {
      const storedLCFAddress = await laoToken.lockupContractFactory()

      assert.equal(lockupContractFactory.address, storedLCFAddress)
    })

    it("Mints the correct LAO amount to the multisig's address: (64.66 million)", async () => {
      const multisigLAOEntitlement = await laoToken.balanceOf(multisig)

     const twentyThreeSixes = "6".repeat(23)
      const expectedMultisigEntitlement = "64".concat(twentyThreeSixes).concat("7")
      assert.equal(multisigLAOEntitlement, expectedMultisigEntitlement)
    })

    it("Mints the correct LAO amount to the CommunityIssuance contract address: 32 million", async () => {
      const communityLAOEntitlement = await laoToken.balanceOf(communityIssuance.address)
      // 32 million as 18-digit decimal
      const _32Million = dec(32, 24)

      assert.equal(communityLAOEntitlement, _32Million)
    })

    it("Mints the correct LAO amount to the bountyAddress EOA: 2 million", async () => {
      const bountyAddressBal = await laoToken.balanceOf(bountyAddress)
      // 2 million as 18-digit decimal
      const _2Million = dec(2, 24)

      assert.equal(bountyAddressBal, _2Million)
    })

    it("Mints the correct LAO amount to the lpRewardsAddress EOA: 1.33 million", async () => {
      const lpRewardsAddressBal = await laoToken.balanceOf(lpRewardsAddress)
      // 1.3 million as 18-digit decimal
      const _1pt33Million = "1".concat("3".repeat(24))

      assert.equal(lpRewardsAddressBal, _1pt33Million)
    })
  })

  describe('Community Issuance deployment', async accounts => {
    it("Stores the deployer's address", async () => {

      const storedDeployerAddress = await communityIssuance.owner()

      assert.equal(storedDeployerAddress, liquityAG)
    })

    it("Has a supply cap of 32 million", async () => {
      const supplyCap = await communityIssuance.LAOSupplyCap()

      assert.isTrue(expectedCISupplyCap.eq(supplyCap))
    })

    it("Liquity AG can set addresses if CI's LAO balance is equal or greater than 32 million ", async () => {
      const LAOBalance = await laoToken.balanceOf(communityIssuance.address)
      assert.isTrue(LAOBalance.eq(expectedCISupplyCap))

      // Deploy core contracts, just to get the Stability Pool address
      const coreContracts = await deploymentHelper.deployLiquityCore()

      const tx = await communityIssuance.setAddresses(
        laoToken.address,
        coreContracts.stabilityPool.address,
        { from: liquityAG }
      );
      assert.isTrue(tx.receipt.status)
    })

    it("Liquity AG can't set addresses if CI's LAO balance is < 32 million ", async () => {
      const newCI = await CommunityIssuance.new()

      const LAOBalance = await laoToken.balanceOf(newCI.address)
      assert.equal(LAOBalance, '0')

      // Deploy core contracts, just to get the Stability Pool address
      const coreContracts = await deploymentHelper.deployLiquityCore()

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)
      await laoToken.transfer(newCI.address, '31999999999999999999999999', {from: multisig}) // 1e-18 less than CI expects (32 million)

      try {
        const tx = await newCI.setAddresses(
          laoToken.address,
          coreContracts.stabilityPool.address,
          { from: liquityAG }
        );
      
        // Check it gives the expected error message for a failed Solidity 'assert'
      } catch (err) {
        assert.include(err.message, "invalid opcode")
      }
    })
  })

  describe('Connecting LAOToken to LCF, CI and LAOStaking', async accounts => {
    it('sets the correct LAOToken address in LAOStaking', async () => {
      // Deploy core contracts and set the LAOToken address in the CI and LAOStaking
      const coreContracts = await deploymentHelper.deployLiquityCore()
      await deploymentHelper.connectLAOContractsToCore(LAOContracts, coreContracts)

      const laoTokenAddress = laoToken.address

      const recordedLAOTokenAddress = await laoStaking.laoToken()
      assert.equal(laoTokenAddress, recordedLAOTokenAddress)
    })

    it('sets the correct LAOToken address in LockupContractFactory', async () => {
      const laoTokenAddress = laoToken.address

      const recordedLAOTokenAddress = await lockupContractFactory.laoTokenAddress()
      assert.equal(laoTokenAddress, recordedLAOTokenAddress)
    })

    it('sets the correct LAOToken address in CommunityIssuance', async () => {
      // Deploy core contracts and set the LAOToken address in the CI and LAOStaking
      const coreContracts = await deploymentHelper.deployLiquityCore()
      await deploymentHelper.connectLAOContractsToCore(LAOContracts, coreContracts)

      const laoTokenAddress = laoToken.address

      const recordedLAOTokenAddress = await communityIssuance.laoToken()
      assert.equal(laoTokenAddress, recordedLAOTokenAddress)
    })
  })
})

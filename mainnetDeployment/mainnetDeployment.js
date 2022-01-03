const { UniswapV2Factory } = require("./ABIs/UniswapV2Factory.js")
const { UniswapV2Pair } = require("./ABIs/UniswapV2Pair.js")
const { UniswapV2Router02 } = require("./ABIs/UniswapV2Router02.js")
const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th
const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const toBigNum = ethers.BigNumber.from

async function mainnetDeploy(configParams) {
  const date = new Date()
  console.log(date.toUTCString())
  const deployerWallet = (await ethers.getSigners())[0]
  // const account2Wallet = (await ethers.getSigners())[1]
  const mdh = new MainnetDeploymentHelper(configParams, deployerWallet)
  const gasPrice = configParams.GAS_PRICE

  const deploymentState = mdh.loadPreviousDeployment()

  console.log(`deployer address: ${deployerWallet.address}`)
  assert.equal(deployerWallet.address, configParams.liquityAddrs.DEPLOYER)
  // assert.equal(account2Wallet.address, configParams.beneficiaries.ACCOUNT_2)
  let deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployerETHBalance before: ${deployerETHBalance}`)

  // Get UniswapV2Factory instance at its deployed address
  const uniswapV2Factory = new ethers.Contract(
    configParams.externalAddrs.UNISWAP_V2_FACTORY,
    UniswapV2Factory.abi,
    deployerWallet
  )

  console.log(`Uniswp addr: ${uniswapV2Factory.address}`)
  const uniAllPairsLength = await uniswapV2Factory.allPairsLength()
  console.log(`Uniswap Factory number of pairs: ${uniAllPairsLength}`)

  deployerETHBalance = await ethers.provider.getBalance(deployerWallet.address)
  console.log(`deployer's ETH balance before deployments: ${deployerETHBalance}`)

  // Deploy core logic contracts
  const liquityCore = await mdh.deployLiquityCoreMainnet(configParams.externalAddrs.TELLOR_MASTER, deploymentState)
  await mdh.logContractObjects(liquityCore)

  // Check Uniswap Pair LAI-ETH pair before pair creation
  let LAIWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.laiToken.address, configParams.externalAddrs.WETH_ERC20)
  let WETHLAIPairAddr = await uniswapV2Factory.getPair(configParams.externalAddrs.WETH_ERC20, liquityCore.laiToken.address)
  assert.equal(LAIWETHPairAddr, WETHLAIPairAddr)


  if (LAIWETHPairAddr == th.ZERO_ADDRESS) {
    // Deploy Unipool for LAI-WETH
    await mdh.sendAndWaitForTransaction(uniswapV2Factory.createPair(
      configParams.externalAddrs.WETH_ERC20,
      liquityCore.laiToken.address,
      { gasPrice }
    ))

    // Check Uniswap Pair LAI-WETH pair after pair creation (forwards and backwards should have same address)
    LAIWETHPairAddr = await uniswapV2Factory.getPair(liquityCore.laiToken.address, configParams.externalAddrs.WETH_ERC20)
    assert.notEqual(LAIWETHPairAddr, th.ZERO_ADDRESS)
    WETHLAIPairAddr = await uniswapV2Factory.getPair(configParams.externalAddrs.WETH_ERC20, liquityCore.laiToken.address)
    console.log(`LAI-WETH pair contract address after Uniswap pair creation: ${LAIWETHPairAddr}`)
    assert.equal(WETHLAIPairAddr, LAIWETHPairAddr)
  }

  // Deploy Unipool
  const unipool = await mdh.deployUnipoolMainnet(deploymentState)

  // Deploy LAO Contracts
  const LAOContracts = await mdh.deployLAOContractsMainnet(
    configParams.liquityAddrs.GENERAL_SAFE, // bounty address
    unipool.address,  // lp rewards address
    configParams.liquityAddrs.LAO_SAFE, // multisig LAO endowment address
    deploymentState,
  )

  // Connect all core contracts up
  await mdh.connectCoreContractsMainnet(liquityCore, LAOContracts, configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY)
  await mdh.connectLAOContractsMainnet(LAOContracts)
  await mdh.connectLAOContractsToCoreMainnet(LAOContracts, liquityCore)

  // Deploy a read-only multi-trove getter
  const multiTroveGetter = await mdh.deployMultiTroveGetterMainnet(liquityCore, deploymentState)

  // Connect Unipool to LAOToken and the LAI-WETH pair address, with a 6 week duration
  const LPRewardsDuration = timeVals.SECONDS_IN_SIX_WEEKS
  await mdh.connectUnipoolMainnet(unipool, LAOContracts, LAIWETHPairAddr, LPRewardsDuration)

  // Log LAO and Unipool addresses
  await mdh.logContractObjects(LAOContracts)
  console.log(`Unipool address: ${unipool.address}`)
  
  // let latestBlock = await ethers.provider.getBlockNumber()
  let deploymentStartTime = await LAOContracts.laoToken.getDeploymentStartTime()

  console.log(`deployment start time: ${deploymentStartTime}`)
  const oneYearFromDeployment = (Number(deploymentStartTime) + timeVals.SECONDS_IN_ONE_YEAR).toString()
  console.log(`time oneYearFromDeployment: ${oneYearFromDeployment}`)

  // Deploy LockupContracts - one for each beneficiary
  const lockupContracts = {}

  for (const [investor, investorAddr] of Object.entries(configParams.beneficiaries)) {
    const lockupContractEthersFactory = await ethers.getContractFactory("LockupContract", deployerWallet)
    if (deploymentState[investor] && deploymentState[investor].address) {
      console.log(`Using previously deployed ${investor} lockup contract at address ${deploymentState[investor].address}`)
      lockupContracts[investor] = new ethers.Contract(
        deploymentState[investor].address,
        lockupContractEthersFactory.interface,
        deployerWallet
      )
    } else {
      const txReceipt = await mdh.sendAndWaitForTransaction(LAOContracts.lockupContractFactory.deployLockupContract(investorAddr, oneYearFromDeployment, { gasPrice }))

      const address = await txReceipt.logs[0].address // The deployment event emitted from the LC itself is is the first of two events, so this is its address 
      lockupContracts[investor] = new ethers.Contract(
        address,
        lockupContractEthersFactory.interface,
        deployerWallet
      )

      deploymentState[investor] = {
        address: address,
        txHash: txReceipt.transactionHash
      }

      mdh.saveDeployment(deploymentState)
    }

    const laoTokenAddr = LAOContracts.laoToken.address
    // verify
    if (configParams.ETHERSCAN_BASE_URL) {
      await mdh.verifyContract(investor, deploymentState, [laoTokenAddr, investorAddr, oneYearFromDeployment])
    }
  }

  // // --- TESTS AND CHECKS  ---

  // Deployer repay LAI
  // console.log(`deployer trove debt before repaying: ${await liquityCore.troveManager.getTroveDebt(deployerWallet.address)}`)
 // await mdh.sendAndWaitForTransaction(liquityCore.borrowerOperations.repayLAI(dec(800, 18), th.ZERO_ADDRESS, th.ZERO_ADDRESS, {gasPrice, gasLimit: 1000000}))
  // console.log(`deployer trove debt after repaying: ${await liquityCore.troveManager.getTroveDebt(deployerWallet.address)}`)
  
  // Deployer add coll
  // console.log(`deployer trove coll before adding coll: ${await liquityCore.troveManager.getTroveColl(deployerWallet.address)}`)
  // await mdh.sendAndWaitForTransaction(liquityCore.borrowerOperations.addColl(th.ZERO_ADDRESS, th.ZERO_ADDRESS, {value: dec(2, 'ether'), gasPrice, gasLimit: 1000000}))
  // console.log(`deployer trove coll after addingColl: ${await liquityCore.troveManager.getTroveColl(deployerWallet.address)}`)
  
  // Check chainlink proxy price ---

  const chainlinkProxy = new ethers.Contract(
    configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY,
    ChainlinkAggregatorV3Interface,
    deployerWallet
  )

  // Get latest price
  let chainlinkPrice = await chainlinkProxy.latestAnswer()
  console.log(`current Chainlink price: ${chainlinkPrice}`)

  // Check Tellor price directly (through our TellorCaller)
  let tellorPriceResponse = await liquityCore.tellorCaller.getTellorCurrentValue(1) // id == 1: the ETH-USD request ID
  console.log(`current Tellor price: ${tellorPriceResponse[1]}`)
  console.log(`current Tellor timestamp: ${tellorPriceResponse[2]}`)

  // // --- Lockup Contracts ---
  console.log("LOCKUP CONTRACT CHECKS")
  // Check lockup contracts exist for each beneficiary with correct unlock time
  for (investor of Object.keys(lockupContracts)) {
    const lockupContract = lockupContracts[investor]
    // check LC references correct LAOToken 
    const storedLAOTokenAddr = await lockupContract.laoToken()
    assert.equal(LAOContracts.laoToken.address, storedLAOTokenAddr)
    // Check contract has stored correct beneficary
    const onChainBeneficiary = await lockupContract.beneficiary()
    assert.equal(configParams.beneficiaries[investor].toLowerCase(), onChainBeneficiary.toLowerCase())
    // Check correct unlock time (1 yr from deployment)
    const unlockTime = await lockupContract.unlockTime()
    assert.equal(oneYearFromDeployment, unlockTime)

    console.log(
      `lockupContract addr: ${lockupContract.address},
            stored LAOToken addr: ${storedLAOTokenAddr}
            beneficiary: ${investor},
            beneficiary addr: ${configParams.beneficiaries[investor]},
            on-chain beneficiary addr: ${onChainBeneficiary},
            unlockTime: ${unlockTime}
            `
    )
  }

  // // --- Check correct addresses set in LAOToken
  // console.log("STORED ADDRESSES IN LAO TOKEN")
  // const storedMultisigAddress = await LAOContracts.laoToken.multisigAddress()
  // assert.equal(configParams.liquityAddrs.LAO_SAFE.toLowerCase(), storedMultisigAddress.toLowerCase())
  // console.log(`multi-sig address stored in LAOToken : ${th.squeezeAddr(storedMultisigAddress)}`)
  // console.log(`LAO Safe address: ${th.squeezeAddr(configParams.liquityAddrs.LAO_SAFE)}`)

  // // --- LAO allowances of different addresses ---
  // console.log("INITIAL LAO BALANCES")
  // // Unipool
  // const unipoolLAOBal = await LAOContracts.laoToken.balanceOf(unipool.address)
  // // assert.equal(unipoolLAOBal.toString(), '1333333333333333333333333')
  // th.logBN('Unipool LAO balance       ', unipoolLAOBal)

  // // LAO Safe
  // const laoSafeBal = await LAOContracts.laoToken.balanceOf(configParams.liquityAddrs.LAO_SAFE)
  // assert.equal(laoSafeBal.toString(), '64666666666666666666666667')
  // th.logBN('LAO Safe balance     ', laoSafeBal)

  // // Bounties/hackathons (General Safe)
  // const generalSafeBal = await LAOContracts.laoToken.balanceOf(configParams.liquityAddrs.GENERAL_SAFE)
  // assert.equal(generalSafeBal.toString(), '2000000000000000000000000')
  // th.logBN('General Safe balance       ', generalSafeBal)

  // // CommunityIssuance contract
  // const communityIssuanceBal = await LAOContracts.laoToken.balanceOf(LAOContracts.communityIssuance.address)
  // // assert.equal(communityIssuanceBal.toString(), '32000000000000000000000000')
  // th.logBN('Community Issuance balance', communityIssuanceBal)

  // // --- PriceFeed ---
  // console.log("PRICEFEED CHECKS")
  // // Check Pricefeed's status and last good price
  // const lastGoodPrice = await liquityCore.priceFeed.lastGoodPrice()
  // const priceFeedInitialStatus = await liquityCore.priceFeed.status()
  // th.logBN('PriceFeed first stored price', lastGoodPrice)
  // console.log(`PriceFeed initial status: ${priceFeedInitialStatus}`)

  // // Check PriceFeed's & TellorCaller's stored addresses
  // const priceFeedCLAddress = await liquityCore.priceFeed.priceAggregator()
  // const priceFeedTellorCallerAddress = await liquityCore.priceFeed.tellorCaller()
  // assert.equal(priceFeedCLAddress, configParams.externalAddrs.CHAINLINK_ETHUSD_PROXY)
  // assert.equal(priceFeedTellorCallerAddress, liquityCore.tellorCaller.address)

  // // Check Tellor address
  // const tellorCallerTellorMasterAddress = await liquityCore.tellorCaller.tellor()
  // assert.equal(tellorCallerTellorMasterAddress, configParams.externalAddrs.TELLOR_MASTER)

  // // --- Unipool ---

  // // Check Unipool's LAI-ETH Uniswap Pair address
  // const unipoolUniswapPairAddr = await unipool.uniToken()
  // console.log(`Unipool's stored LAI-ETH Uniswap Pair address: ${unipoolUniswapPairAddr}`)

  // console.log("SYSTEM GLOBAL VARS CHECKS")
  // // --- Sorted Troves ---

  // // Check max size
  // const sortedTrovesMaxSize = (await liquityCore.sortedTroves.data())[2]
  // assert.equal(sortedTrovesMaxSize, '115792089237316195423570985008687907853269984665640564039457584007913129639935')

  // // --- TroveManager ---

  // const liqReserve = await liquityCore.troveManager.LAI_GAS_COMPENSATION()
  // const minNetDebt = await liquityCore.troveManager.MIN_NET_DEBT()

  // th.logBN('system liquidation reserve', liqReserve)
  // th.logBN('system min net debt      ', minNetDebt)

  // // --- Make first LAI-ETH liquidity provision ---

  // // Open trove if not yet opened
  // const troveStatus = await liquityCore.troveManager.getTroveStatus(deployerWallet.address)
  // if (troveStatus.toString() != '1') {
  //   let _3kLAIWithdrawal = th.dec(3000, 18) // 3000 LAI
  //   let _3ETHcoll = th.dec(3, 'ether') // 3 ETH
  //   console.log('Opening trove...')
  //   await mdh.sendAndWaitForTransaction(
  //     liquityCore.borrowerOperations.openTrove(
  //       th._100pct,
  //       _3kLAIWithdrawal,
  //       th.ZERO_ADDRESS,
  //       th.ZERO_ADDRESS,
  //       { value: _3ETHcoll, gasPrice }
  //     )
  //   )
  // } else {
  //   console.log('Deployer already has an active trove')
  // }

  // // Check deployer now has an open trove
  // console.log(`deployer is in sorted list after making trove: ${await liquityCore.sortedTroves.contains(deployerWallet.address)}`)

  // const deployerTrove = await liquityCore.troveManager.Troves(deployerWallet.address)
  // th.logBN('deployer debt', deployerTrove[0])
  // th.logBN('deployer coll', deployerTrove[1])
  // th.logBN('deployer stake', deployerTrove[2])
  // console.log(`deployer's trove status: ${deployerTrove[3]}`)

  // // Check deployer has LAI
  // let deployerLAIBal = await liquityCore.laiToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer's LAI balance", deployerLAIBal)

  // // Check Uniswap pool has LAI and WETH tokens
  const LAIETHPair = await new ethers.Contract(
    LAIWETHPairAddr,
    UniswapV2Pair.abi,
    deployerWallet
  )

  // const token0Addr = await LAIETHPair.token0()
  // const token1Addr = await LAIETHPair.token1()
  // console.log(`LAI-ETH Pair token 0: ${th.squeezeAddr(token0Addr)},
  //       LAIToken contract addr: ${th.squeezeAddr(liquityCore.laiToken.address)}`)
  // console.log(`LAI-ETH Pair token 1: ${th.squeezeAddr(token1Addr)},
  //       WETH ERC20 contract addr: ${th.squeezeAddr(configParams.externalAddrs.WETH_ERC20)}`)

  // // Check initial LAI-ETH pair reserves before provision
  // let reserves = await LAIETHPair.getReserves()
  // th.logBN("LAI-ETH Pair's LAI reserves before provision", reserves[0])
  // th.logBN("LAI-ETH Pair's ETH reserves before provision", reserves[1])

  // // Get the UniswapV2Router contract
  // const uniswapV2Router02 = new ethers.Contract(
  //   configParams.externalAddrs.UNISWAP_V2_ROUTER02,
  //   UniswapV2Router02.abi,
  //   deployerWallet
  // )

  // // --- Provide liquidity to LAI-ETH pair if not yet done so ---
  // let deployerLPTokenBal = await LAIETHPair.balanceOf(deployerWallet.address)
  // if (deployerLPTokenBal.toString() == '0') {
  //   console.log('Providing liquidity to Uniswap...')
  //   // Give router an allowance for LAI
  //   await liquityCore.laiToken.increaseAllowance(uniswapV2Router02.address, dec(10000, 18))

  //   // Check Router's spending allowance
  //   const routerLAIAllowanceFromDeployer = await liquityCore.laiToken.allowance(deployerWallet.address, uniswapV2Router02.address)
  //   th.logBN("router's spending allowance for deployer's LAI", routerLAIAllowanceFromDeployer)

  //   // Get amounts for liquidity provision
  //   const LP_ETH = dec(1, 'ether')

  //   // Convert 8-digit CL price to 18 and multiply by ETH amount
  //   const LAIAmount = toBigNum(chainlinkPrice)
  //     .mul(toBigNum(dec(1, 10)))
  //     .mul(toBigNum(LP_ETH))
  //     .div(toBigNum(dec(1, 18)))

  //   const minLAIAmount = LAIAmount.sub(toBigNum(dec(100, 18)))

  //   latestBlock = await ethers.provider.getBlockNumber()
  //   now = (await ethers.provider.getBlock(latestBlock)).timestamp
  //   let tenMinsFromNow = now + (60 * 60 * 10)

  //   // Provide liquidity to LAI-ETH pair
  //   await mdh.sendAndWaitForTransaction(
  //     uniswapV2Router02.addLiquidityETH(
  //       liquityCore.laiToken.address, // address of LAI token
  //       LAIAmount, // LAI provision
  //       minLAIAmount, // minimum LAI provision
  //       LP_ETH, // minimum ETH provision
  //       deployerWallet.address, // address to send LP tokens to
  //       tenMinsFromNow, // deadline for this tx
  //       {
  //         value: dec(1, 'ether'),
  //         gasPrice,
  //         gasLimit: 5000000 // For some reason, ethers can't estimate gas for this tx
  //       }
  //     )
  //   )
  // } else {
  //   console.log('Liquidity already provided to Uniswap')
  // }
  // // Check LAI-ETH reserves after liquidity provision:
  // reserves = await LAIETHPair.getReserves()
  // th.logBN("LAI-ETH Pair's LAI reserves after provision", reserves[0])
  // th.logBN("LAI-ETH Pair's ETH reserves after provision", reserves[1])



  // // ---  Check LP staking  ---
  // console.log("CHECK LP STAKING EARNS LAO")

  // // Check deployer's LP tokens
  // deployerLPTokenBal = await LAIETHPair.balanceOf(deployerWallet.address)
  // th.logBN("deployer's LP token balance", deployerLPTokenBal)

  // // Stake LP tokens in Unipool
  // console.log(`LAIETHPair addr: ${LAIETHPair.address}`)
  // console.log(`Pair addr stored in Unipool: ${await unipool.uniToken()}`)

  // earnedLAO = await unipool.earned(deployerWallet.address)
  // th.logBN("deployer's farmed LAO before staking LP tokens", earnedLAO)

  // const deployerUnipoolStake = await unipool.balanceOf(deployerWallet.address)
  // if (deployerUnipoolStake.toString() == '0') {
  //   console.log('Staking to Unipool...')
  //   // Deployer approves Unipool
  //   await mdh.sendAndWaitForTransaction(
  //     LAIETHPair.approve(unipool.address, deployerLPTokenBal, { gasPrice })
  //   )

  //   await mdh.sendAndWaitForTransaction(unipool.stake(1, { gasPrice }))
  // } else {
  //   console.log('Already staked in Unipool')
  // }

  // console.log("wait 90 seconds before checking earnings... ")
  // await configParams.waitFunction()

  // earnedLAO = await unipool.earned(deployerWallet.address)
  // th.logBN("deployer's farmed LAO from Unipool after waiting ~1.5mins", earnedLAO)

  // let deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer LAO Balance Before SP deposit", deployerLAOBal)



  // // --- Make SP deposit and earn LAO ---
  // console.log("CHECK DEPLOYER MAKING DEPOSIT AND EARNING LAO")

  // let SPDeposit = await liquityCore.stabilityPool.getCompoundedLAIDeposit(deployerWallet.address)
  // th.logBN("deployer SP deposit before making deposit", SPDeposit)

  // // Provide to SP
  // await mdh.sendAndWaitForTransaction(liquityCore.stabilityPool.provideToSP(dec(15, 18), th.ZERO_ADDRESS, { gasPrice, gasLimit: 400000 }))

  // // Get SP deposit 
  // SPDeposit = await liquityCore.stabilityPool.getCompoundedLAIDeposit(deployerWallet.address)
  // th.logBN("deployer SP deposit after depositing 15 LAI", SPDeposit)

  // console.log("wait 90 seconds before withdrawing...")
  // // wait 90 seconds
  // await configParams.waitFunction()

  // // Withdraw from SP
  // // await mdh.sendAndWaitForTransaction(liquityCore.stabilityPool.withdrawFromSP(dec(1000, 18), { gasPrice, gasLimit: 400000 }))

  // // SPDeposit = await liquityCore.stabilityPool.getCompoundedLAIDeposit(deployerWallet.address)
  // // th.logBN("deployer SP deposit after full withdrawal", SPDeposit)

  // // deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  // // th.logBN("deployer LAO Balance after SP deposit withdrawal", deployerLAOBal)



  // // ---  Attempt withdrawal from LC  ---
  // console.log("CHECK BENEFICIARY ATTEMPTING WITHDRAWAL FROM LC")

  // // connect Acct2 wallet to the LC they are beneficiary of
  // let account2LockupContract = await lockupContracts["ACCOUNT_2"].connect(account2Wallet)

  // // Deployer funds LC with 10 LAO
  // // await mdh.sendAndWaitForTransaction(LAOContracts.laoToken.transfer(account2LockupContract.address, dec(10, 18), { gasPrice }))

  // // account2 LAO bal
  // let account2bal = await LAOContracts.laoToken.balanceOf(account2Wallet.address)
  // th.logBN("account2 LAO bal before withdrawal attempt", account2bal)

  // // Check LC LAO bal 
  // let account2LockupContractBal = await LAOContracts.laoToken.balanceOf(account2LockupContract.address)
  // th.logBN("account2's LC LAO bal before withdrawal attempt", account2LockupContractBal)

  // // Acct2 attempts withdrawal from  LC
  // await mdh.sendAndWaitForTransaction(account2LockupContract.withdrawLAO({ gasPrice, gasLimit: 1000000 }))

  // // Acct LAO bal
  // account2bal = await LAOContracts.laoToken.balanceOf(account2Wallet.address)
  // th.logBN("account2's LAO bal after LC withdrawal attempt", account2bal)

  // // Check LC bal 
  // account2LockupContractBal = await LAOContracts.laoToken.balanceOf(account2LockupContract.address)
  // th.logBN("account2's LC LAO bal LC withdrawal attempt", account2LockupContractBal)

  // // --- Stake LAO ---
  // console.log("CHECK DEPLOYER STAKING LAO")

  // // Log deployer LAO bal and stake before staking
  // deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer LAO bal before staking", deployerLAOBal)
  // let deployerLAOStake = await LAOContracts.laoStaking.stakes(deployerWallet.address)
  // th.logBN("deployer stake before staking", deployerLAOStake)

  // // stake 13 LAO
  // await mdh.sendAndWaitForTransaction(LAOContracts.laoStaking.stake(dec(13, 18), { gasPrice, gasLimit: 1000000 }))

  // // Log deployer LAO bal and stake after staking
  // deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  // th.logBN("deployer LAO bal after staking", deployerLAOBal)
  // deployerLAOStake = await LAOContracts.laoStaking.stakes(deployerWallet.address)
  // th.logBN("deployer stake after staking", deployerLAOStake)

  // // Log deployer rev share immediately after staking
  // let deployerLAIRevShare = await LAOContracts.laoStaking.getPendingLAIGain(deployerWallet.address)
  // th.logBN("deployer pending LAI revenue share", deployerLAIRevShare)



  // // --- 2nd Account opens trove ---
  // const trove2Status = await liquityCore.troveManager.getTroveStatus(account2Wallet.address)
  // if (trove2Status.toString() != '1') {
  //   console.log("Acct 2 opens a trove ...")
  //   let _2kLAIWithdrawal = th.dec(2000, 18) // 2000 LAI
  //   let _1pt5_ETHcoll = th.dec(15, 17) // 1.5 ETH
  //   const borrowerOpsEthersFactory = await ethers.getContractFactory("BorrowerOperations", account2Wallet)
  //   const borrowerOpsAcct2 = await new ethers.Contract(liquityCore.borrowerOperations.address, borrowerOpsEthersFactory.interface, account2Wallet)

  //   await mdh.sendAndWaitForTransaction(borrowerOpsAcct2.openTrove(th._100pct, _2kLAIWithdrawal, th.ZERO_ADDRESS, th.ZERO_ADDRESS, { value: _1pt5_ETHcoll, gasPrice, gasLimit: 1000000 }))
  // } else {
  //   console.log('Acct 2 already has an active trove')
  // }

  // const acct2Trove = await liquityCore.troveManager.Troves(account2Wallet.address)
  // th.logBN('acct2 debt', acct2Trove[0])
  // th.logBN('acct2 coll', acct2Trove[1])
  // th.logBN('acct2 stake', acct2Trove[2])
  // console.log(`acct2 trove status: ${acct2Trove[3]}`)

  // // Log deployer's pending LAI gain - check fees went to staker (deloyer)
  // deployerLAIRevShare = await LAOContracts.laoStaking.getPendingLAIGain(deployerWallet.address)
  // th.logBN("deployer pending LAI revenue share from staking, after acct 2 opened trove", deployerLAIRevShare)

  // //  --- deployer withdraws staking gains ---
  // console.log("CHECK DEPLOYER WITHDRAWING STAKING GAINS")

  // // check deployer's LAI balance before withdrawing staking gains
  // deployerLAIBal = await liquityCore.laiToken.balanceOf(deployerWallet.address)
  // th.logBN('deployer LAI bal before withdrawing staking gains', deployerLAIBal)

  // // Deployer withdraws staking gains
  // await mdh.sendAndWaitForTransaction(LAOContracts.laoStaking.unstake(0, { gasPrice, gasLimit: 1000000 }))

  // // check deployer's LAI balance after withdrawing staking gains
  // deployerLAIBal = await liquityCore.laiToken.balanceOf(deployerWallet.address)
  // th.logBN('deployer LAI bal after withdrawing staking gains', deployerLAIBal)


  // // --- System stats  ---

  // Uniswap LAI-ETH pool size
  reserves = await LAIETHPair.getReserves()
  th.logBN("LAI-ETH Pair's current LAI reserves", reserves[0])
  th.logBN("LAI-ETH Pair's current ETH reserves", reserves[1])

  // Number of troves
  const numTroves = await liquityCore.troveManager.getTroveOwnersCount()
  console.log(`number of troves: ${numTroves} `)

  // Sorted list size
  const listSize = await liquityCore.sortedTroves.getSize()
  console.log(`Trove list size: ${listSize} `)

  // Total system debt and coll
  const entireSystemDebt = await liquityCore.troveManager.getEntireSystemDebt()
  const entireSystemColl = await liquityCore.troveManager.getEntireSystemColl()
  th.logBN("Entire system debt", entireSystemDebt)
  th.logBN("Entire system coll", entireSystemColl)
  
  // TCR
  const TCR = await liquityCore.troveManager.getTCR(chainlinkPrice)
  console.log(`TCR: ${TCR}`)

  // current borrowing rate
  const baseRate = await liquityCore.troveManager.baseRate()
  const currentBorrowingRate = await liquityCore.troveManager.getBorrowingRateWithDecay()
  th.logBN("Base rate", baseRate)
  th.logBN("Current borrowing rate", currentBorrowingRate)

  // total SP deposits
  const totalSPDeposits = await liquityCore.stabilityPool.getTotalLAIDeposits()
  th.logBN("Total LAI SP deposits", totalSPDeposits)

  // total LAO Staked in LAOStaking
  const totalLAOStaked = await LAOContracts.laoStaking.totalLAOStaked()
  th.logBN("Total LAO staked", totalLAOStaked)

  // total LP tokens staked in Unipool
  const totalLPTokensStaked = await unipool.totalSupply()
  th.logBN("Total LP (LAI-ETH) tokens staked in unipool", totalLPTokensStaked)

  // --- State variables ---

  // TroveManager 
  console.log("TroveManager state variables:")
  const totalStakes = await liquityCore.troveManager.totalStakes()
  const totalStakesSnapshot = await liquityCore.troveManager.totalStakesSnapshot()
  const totalCollateralSnapshot = await liquityCore.troveManager.totalCollateralSnapshot()
  th.logBN("Total trove stakes", totalStakes)
  th.logBN("Snapshot of total trove stakes before last liq. ", totalStakesSnapshot)
  th.logBN("Snapshot of total trove collateral before last liq. ", totalCollateralSnapshot)

  const L_ETH = await liquityCore.troveManager.L_ETH()
  const L_LAIDebt = await liquityCore.troveManager.L_LAIDebt()
  th.logBN("L_ETH", L_ETH)
  th.logBN("L_LAIDebt", L_LAIDebt)

  // StabilityPool
  console.log("StabilityPool state variables:")
  const P = await liquityCore.stabilityPool.P()
  const currentScale = await liquityCore.stabilityPool.currentScale()
  const currentEpoch = await liquityCore.stabilityPool.currentEpoch()
  const S = await liquityCore.stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
  const G = await liquityCore.stabilityPool.epochToScaleToG(currentEpoch, currentScale)
  th.logBN("Product P", P)
  th.logBN("Current epoch", currentEpoch)
  th.logBN("Current scale", currentScale)
  th.logBN("Sum S, at current epoch and scale", S)
  th.logBN("Sum G, at current epoch and scale", G)

  // LAOStaking
  console.log("LAOStaking state variables:")
  const F_LAI = await LAOContracts.laoStaking.F_LAI()
  const F_ETH = await LAOContracts.laoStaking.F_ETH()
  th.logBN("F_LAI", F_LAI)
  th.logBN("F_ETH", F_ETH)


  // CommunityIssuance
  console.log("CommunityIssuance state variables:")
  const totalLAOIssued = await LAOContracts.communityIssuance.totalLAOIssued()
  th.logBN("Total LAO issued to depositors / front ends", totalLAOIssued)


  // TODO: Uniswap *LAO-ETH* pool size (check it's deployed?)















  // ************************
  // --- NOT FOR APRIL 5: Deploy a LAOToken2 with General Safe as beneficiary to test minting LAO showing up in Gnosis App  ---

  // // General Safe LAO bal before:
  // const realGeneralSafeAddr = "0xF06016D822943C42e3Cb7FC3a6A3B1889C1045f8"

  //   const LAOToken2EthersFactory = await ethers.getContractFactory("LAOToken2", deployerWallet)
  //   const laoToken2 = await LAOToken2EthersFactory.deploy( 
  //     "0xF41E0DD45d411102ed74c047BdA544396cB71E27",  // CI param: LC1 
  //     "0x9694a04263593AC6b895Fc01Df5929E1FC7495fA", // LAO Staking param: LC2
  //     "0x98f95E112da23c7b753D8AE39515A585be6Fb5Ef", // LCF param: LC3
  //     realGeneralSafeAddr,  // bounty/hackathon param: REAL general safe addr
  //     "0x98f95E112da23c7b753D8AE39515A585be6Fb5Ef", // LP rewards param: LC3
  //     deployerWallet.address, // multisig param: deployer wallet
  //     {gasPrice, gasLimit: 10000000}
  //   )

  //   console.log(`lao2 address: ${laoToken2.address}`)

  //   let generalSafeLAOBal = await laoToken2.balanceOf(realGeneralSafeAddr)
  //   console.log(`generalSafeLAOBal: ${generalSafeLAOBal}`)



  // ************************
  // --- NOT FOR APRIL 5: Test short-term lockup contract LAO withdrawal on mainnet ---

  // now = (await ethers.provider.getBlock(latestBlock)).timestamp

  // const LCShortTermEthersFactory = await ethers.getContractFactory("LockupContractShortTerm", deployerWallet)

  // new deployment
  // const LCshortTerm = await LCShortTermEthersFactory.deploy(
  //   LAOContracts.laoToken.address,
  //   deployerWallet.address,
  //   now, 
  //   {gasPrice, gasLimit: 1000000}
  // )

  // LCshortTerm.deployTransaction.wait()

  // existing deployment
  // const deployedShortTermLC = await new ethers.Contract(
  //   "0xbA8c3C09e9f55dA98c5cF0C28d15Acb927792dC7", 
  //   LCShortTermEthersFactory.interface,
  //   deployerWallet
  // )

  // new deployment
  // console.log(`Short term LC Address:  ${LCshortTerm.address}`)
  // console.log(`recorded beneficiary in short term LC:  ${await LCshortTerm.beneficiary()}`)
  // console.log(`recorded short term LC name:  ${await LCshortTerm.NAME()}`)

  // existing deployment
  //   console.log(`Short term LC Address:  ${deployedShortTermLC.address}`)
  //   console.log(`recorded beneficiary in short term LC:  ${await deployedShortTermLC.beneficiary()}`)
  //   console.log(`recorded short term LC name:  ${await deployedShortTermLC.NAME()}`)
  //   console.log(`recorded short term LC name:  ${await deployedShortTermLC.unlockTime()}`)
  //   now = (await ethers.provider.getBlock(latestBlock)).timestamp
  //   console.log(`time now: ${now}`)

  //   // check deployer LAO bal
  //   let deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  //   console.log(`deployerLAOBal before he withdraws: ${deployerLAOBal}`)

  //   // check LC LAO bal
  //   let LC_LAOBal = await LAOContracts.laoToken.balanceOf(deployedShortTermLC.address)
  //   console.log(`LC LAO bal before withdrawal: ${LC_LAOBal}`)

  // // withdraw from LC
  // const withdrawFromShortTermTx = await deployedShortTermLC.withdrawLAO( {gasPrice, gasLimit: 1000000})
  // withdrawFromShortTermTx.wait()

  // // check deployer bal after LC withdrawal
  // deployerLAOBal = await LAOContracts.laoToken.balanceOf(deployerWallet.address)
  // console.log(`deployerLAOBal after he withdraws: ${deployerLAOBal}`)

  //   // check LC LAO bal
  //   LC_LAOBal = await LAOContracts.laoToken.balanceOf(deployedShortTermLC.address)
  //   console.log(`LC LAO bal after withdrawal: ${LC_LAOBal}`)
}

module.exports = {
  mainnetDeploy
}

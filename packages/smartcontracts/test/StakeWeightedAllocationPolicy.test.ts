import { waffle, upgrades, ethers as hardhatEthers } from 'hardhat'
import { expect, use } from 'chai'

import type { BountyFactory } from '../typechain/BountyFactory'
import type { Bounty } from '../typechain/Bounty'
import { Contract, ContractFactory, BigNumber, utils, ContractReceipt, ContractTransaction } from 'ethers'
import { IERC677 } from '../typechain/IERC677'
import { IAllocationPolicy } from '../typechain'
import { defaultAbiCoder } from 'ethers/lib/utils'

const { provider: waffleProvider } = waffle
const { parseEther } = utils
const { provider, getContractFactory } = hardhatEthers

const { log } = console

use(waffle.solidity)

async function advanceToTimestamp(timestamp: number, message?: string) {
    log("\nt = %s ", timestamp, message ?? "")
    await provider.send("evm_setNextBlockTimestamp", [timestamp])
    await provider.send('evm_mine', [0])
}

describe('StakeWeightedAllocationPolicy', (): void => {
    const wallets = waffleProvider.getWallets()
    const adminWallet = wallets[0]
    const brokerWallet = wallets[1]
    const broker2Wallet = wallets[2]
    const trustedForwarderAddress: string = wallets[9].address
    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let tokenAddress: string
    let token: IERC677
    let tokenFromBroker: IERC677
    let allocationPolicy: IAllocationPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Contract
    let bountyFromBroker: Contract

    const timestepSeconds = 1000
    const tokensPerSecond = parseEther("1")

    before(async () => {
        const tokenTxr = await getContractFactory('LinkToken', adminWallet)
        token = await tokenTxr.deploy() as IERC677
        tokenAddress = token.address
        tokenFromBroker = token.connect(brokerWallet)

        const apF = await getContractFactory('StakeWeightedAllocationPolicy', adminWallet)
        const apTx = await apF.deploy() as Contract
        allocationPolicy = await apTx.connect(adminWallet).deployed() as IAllocationPolicy
        log("AllocationPolicy contract: %s, code length = %d", allocationPolicy.address, (await provider.getCode(allocationPolicy.address)).length)

        const agreementFactory = await getContractFactory('Bounty')
        const agreementTemplate = await agreementFactory.deploy()
        await agreementTemplate.deployed()
        log("AgreementTemplate contract: %s, code length = %d", agreementTemplate.address, (await provider.getCode(agreementTemplate.address)).length)

        bountyFactoryFactory = await getContractFactory('BountyFactory', adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ agreementTemplate.address, trustedForwarderAddress, tokenAddress ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
        log("BountyFactory contract: %s, code length = %d", bountyFactory.address, (await provider.getCode(bountyFactory.address)).length)

        log("Token contract code length = %d", (await provider.getCode(token.address)).length)

        await (await token.transfer(brokerWallet.address, parseEther('100'))).wait()
        await (await token.transfer(broker2Wallet.address, parseEther('100'))).wait()
    })

    beforeEach(async () => {
        const agreementtx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++)
        const res = await agreementtx.wait() as ContractReceipt

        const newBountyAddress = res.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.null
        log("Bounty contract: %s, code length = %d", newBountyAddress, (await provider.getCode(newBountyAddress)).length)

        const agreementFactory = await getContractFactory('Bounty')
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty

        const setPolicyTx = await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, tokensPerSecond)
        await setPolicyTx.wait()

        await token.approve(bountyFromAdmin.address, parseEther("100000"))
    })

    it('allocates correctly for single broker (positive test)', async () => {
        await bountyFromAdmin.sponsor(parseEther("100000"))
        const tokensBefore = await token.balanceOf(brokerWallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        await advanceToTimestamp(timeAtStart, "join")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther("1"), brokerWallet.address)).wait()
        const allocationBefore = await bountyFromBroker.getAllocation(brokerWallet.address) as BigNumber

        await advanceToTimestamp(timeAtStart + timestepSeconds + 1, "leave") // TODO: why +1?
        const allocationAfter = (await bountyFromBroker.getAllocation(brokerWallet.address))

        await (await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)

        expect(allocationBefore.toString()).to.equal("0")
        expect(allocationAfter.toString()).to.equal(tokensPerSecond.mul(timestepSeconds).toString())

        // broker now has his stake back and additional winnings
        expect(tokensAfter.sub(tokensBefore).toString()).to.equal(tokensPerSecond.mul(timestepSeconds + 1).toString())
    })

    it('allocates correctly for two brokers, same weight, different join, leave times (positive test)', async function(): Promise<void> {
        //      t0       : broker1 joins
        // t1 = t0 + 1000: broker2 joins
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + half-of-half = 75% of the winnings
        // broker2 should have half-of-half = 25% of the winnings
        await bountyFromAdmin.sponsor(parseEther("100000"))
        const totalTokensExpected = tokensPerSecond.mul(4 * timestepSeconds)

        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        await advanceToTimestamp(timeAtStart, "broker1 joins")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther("1"), brokerWallet.address)).wait()

        await advanceToTimestamp(timeAtStart + timestepSeconds, "broker2 joins")
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther("1"), broker2Wallet.address)).wait()

        await advanceToTimestamp(timeAtStart + 3 * timestepSeconds, "broker2 leaves")
        await (await bountyFromBroker2.leave()).wait()

        await advanceToTimestamp(timeAtStart + 4 * timestepSeconds, "broker1 leaves")
        await (await bountyFromBroker.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const unallocatedWeiAfter = await bountyFromBroker.getUnallocatedWei() as BigNumber
        const tokensBroker1Expected = totalTokensExpected.div(4).mul(3)
        const tokensBroker2Expected = totalTokensExpected.div(4)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
        expect(unallocatedWeiAfter.toString()).to.equal(parseEther("100000").sub(totalTokensExpected).toString())
    })

    it('allocates correctly for two brokers, different weight, different join, leave times (positive test)', async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + 20% of half = 60% of the winnings
        // broker2 should have 80% of half = 40% of the winnings
        const totalTokensExpected = tokensPerSecond.mul(4 * timestepSeconds)
        await bountyFromAdmin.sponsor(parseEther("100000"))

        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        // t0: broker1 joins
        log("\nt = %s", timeAtStart)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('0.1'), brokerWallet.address)).wait()

        // t1: broker2 joins
        log("\nt = %s", timeAtStart + timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther('0.4'), broker2Wallet.address)).wait()

        // t2: broker2 leaves
        log("\nt = %s", timeAtStart + 3 * timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 3 * timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker2.leave()).wait()

        // t3: broker1 leaves
        log("\nt = %s", timeAtStart + 4 * timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 4 * timestepSeconds])
        await provider.send('evm_mine', [0])
        await (await bountyFromBroker.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(60)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(40)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    it('allocates correctly for two brokers, different weight, with adding additional stake', async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1 (1 : 0)
        // t1 = t0 + 2000: broker2 joins, stakes 1 (1 : 1)
        // t2 = t0 + 4000: broker1 adds 3 stake => (4 : 1)
        // t3 = t0 + 6000: broker2 adds 3 stake => (4 : 4)
        // t4 = t0 + 8000: broker2 leaves       => (4 : 0)
        // t5 = t0 +10000: broker1 leaves       => (0 : 0)
        // broker1 should have 20% + 10% + 16% + 10% + 20% = 76% of the winnings
        // broker2 should have  0% + 10% +  4% + 10% +  0% = 24% of the winnings
        const totalTokensExpected = tokensPerSecond.mul(10 * timestepSeconds)
        await bountyFromAdmin.sponsor(parseEther("100000"))

        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 1000) + 1) * 1000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('1'), brokerWallet.address)).wait()

        await advanceToTimestamp(timeAtStart + 2 * timestepSeconds, "Broker 2 joins")
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther('1'), broker2Wallet.address)).wait()

        await advanceToTimestamp(timeAtStart + 4 * timestepSeconds, "Broker 1 adds stake 1 -> 4")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('3'), brokerWallet.address)).wait()

        await advanceToTimestamp(timeAtStart + 6 * timestepSeconds, "Broker 2 adds stake 1 -> 4")
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther('3'), broker2Wallet.address)).wait()

        await advanceToTimestamp(timeAtStart + 8 * timestepSeconds, "Broker 2 leaves")
        await (await bountyFromBroker2.leave()).wait()

        await advanceToTimestamp(timeAtStart + 10 * timestepSeconds, "Broker 1 leaves")
        await (await bountyFromBroker.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(76)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(24)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    it('allocates correctly if money runs out', async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t2 = t0 + 2000: money runs out
        // t3 = t0 + 3000: broker2 leaves
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are expected winnings i.e. owed to brokers
        //            but only half actually allocated and paid out
        // broker1 should have half * (half + 20% of half) = 30% of the winnings
        // broker2 should have half * (80% of half) = 20% of the winnings
        const totalTokensExpected = tokensPerSecond.mul(4 * timestepSeconds)
        await bountyFromAdmin.sponsor(totalTokensExpected.div(2))

        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)

        // t0: broker1 joins
        log("\nt = %s", timeAtStart)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart])
        await provider.send('evm_mine', [0])
        await (await tokenFromBroker.transferAndCall(
            bountyFromBroker.address,
            parseEther('0.1'),
            brokerWallet.address
        )).wait()

        // t1: broker2 joins
        log("\nt = %s", timeAtStart + timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + timestepSeconds])
        await provider.send('evm_mine', [0])
        // const join2Tr =
        await (await tokenFromBroker2.transferAndCall(
            bountyFromBroker.address,
            parseEther('0.4'),
            broker2Wallet.address
        ) as ContractTransaction).wait()
        // console.log("Events: %o", join2Tr.events?.map((e) => e.event))

        // t2: money runs out

        // t3: broker2 leaves
        log("\nt = %s", timeAtStart + 3 * timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 3 * timestepSeconds])
        await provider.send('evm_mine', [0])
        const leave2Tr = await (await bountyFromBroker2.leave() as ContractTransaction).wait()
        // log("Events: %o", leave2Tr.events?.map((e) => e.event))
        const insolvencyEvent = leave2Tr.events?.find((e) => e.event == "InsolvencyStarted")
        // log("%o", insolvencyEvent)

        // t4: broker1 leaves
        log("\nt = %s", timeAtStart + 4 * timestepSeconds)
        await provider.send("evm_setNextBlockTimestamp", [timeAtStart + 4 * timestepSeconds])
        await provider.send('evm_mine', [0])
        const leave1Tr = await (await bountyFromBroker.leave() as ContractTransaction).wait()
        log("Events: %o", leave1Tr.events?.map((e) => e.event))

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(30)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(20)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
        expect(insolvencyEvent).to.not.be.undefined
    })

    it('allocates correctly for two brokers, different weight, with adding additional stake', async function(): Promise<void> {
        //      t0       : both brokers join, stake 1
        // t1 = t0 + 1000: broker 1 adds 2 to his stake
        // t2 = t0 + 2000: both leave
        // in the end 2000*(wei/sec) are winnings
        // broker1 should have half of half + 3/4 of half = 5/8 of the winnings
        // broker2 should have half of half + 1/4 of half = 3/8 of the winnings
        const totalTokensExpected = tokensPerSecond.mul(2 * timestepSeconds)
        await bountyFromAdmin.sponsor(totalTokensExpected.mul(2))

        const tokenFromBroker2 = token.connect(broker2Wallet)
        const bountyFromBroker2 = bountyFromAdmin.connect(broker2Wallet)
        const tokensBroker1Before = await token.balanceOf(brokerWallet.address)
        const tokensBroker2Before = await token.balanceOf(broker2Wallet.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        // t0: broker1 joins
        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('1'), 
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        await (await tokenFromBroker2.transferAndCall(bountyFromBroker.address, parseEther('1'), 
            defaultAbiCoder.encode(["address"], [broker2Wallet.address]))).wait()
        
        // t1: broker2 adds 2 his stake
        await advanceToTimestamp(timeAtStart + timestepSeconds, "Broker 1 joins")
        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('2'), 
            defaultAbiCoder.encode(["address"], [brokerWallet.address]))).wait()
        
        // t2: both leave
        await advanceToTimestamp(timeAtStart + (2 * timestepSeconds), "Broker 1 joins")
        await (await bountyFromBroker.leave()).wait()
        await (await bountyFromBroker2.leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(brokerWallet.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2Wallet.address)).sub(tokensBroker2Before)
        // 5/8 of the winnings, plus one transaction with tokenspersecond shared
        const tokensBroker2Expected = totalTokensExpected.div(8).mul(3).add(tokensPerSecond.div(2))
        // 3/8 of the winnings, plus one transaction with tokenspersecond shared
        const tokensBroker1Expected = totalTokensExpected.div(8).mul(5).add(tokensPerSecond.div(2)) 

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    // TODO: add required staying period feature, then unskip this test
    it.skip('deducts penalty from a broker that leaves too early', async function(): Promise<void> {
        await (await tokenFromBroker.transfer(adminWallet.address, await token.balanceOf(brokerWallet.address))).wait()
        await (await token.transfer(brokerWallet.address, parseEther('10'))).wait()
        const tokensBefore = await token.balanceOf(brokerWallet.address)

        // await (await bountyFromAdmin.setAllocationPolicy(allocationPolicy.address, BigNumber.from('100000'))).wait()

        await token.approve(bountyFromAdmin.address, parseEther('1'))
        await bountyFromAdmin.sponsor(parseEther('1'))

        await (await tokenFromBroker.transferAndCall(bountyFromBroker.address, parseEther('0.5'), "0x")).wait()

        await (await bountyFromBroker.leave()).wait()
        const tokensAfter = await token.balanceOf(brokerWallet.address)

        // broker lost 10% of his stake
        expect(tokensBefore.sub(parseEther('0.05')).eq(tokensAfter)).to.be.true
    })

    it('gets allocation 0 from unjoined broker', async function(): Promise<void> {
        const allocation = await bountyFromAdmin.getAllocation(brokerWallet.address)
        expect(allocation.toString()).to.equal('0')
    })
})

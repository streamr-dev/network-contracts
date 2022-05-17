import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { BigNumber, utils, ContractTransaction } from "ethers"

import { IAllocationPolicy, TestToken, Bounty, BountyFactory, IJoinPolicy, ILeavePolicy } from "../typechain"

const { provider: waffleProvider } = waffle
const { parseEther, formatEther } = utils
const { provider, getContractFactory } = hardhatEthers

// @ts-expect-error should use LogLevel.ERROR
utils.Logger.setLogLevel("ERROR")
const log = (..._: unknown[]) => { /* skip logging */ }
// const { log } = console // TODO: use pino for logging?

use(waffle.solidity)

async function advanceToTimestamp(timestamp: number, message?: string) {
    log("\nt = %s ", timestamp, message ?? "")
    await provider.send("evm_setNextBlockTimestamp", [timestamp])
    await provider.send("evm_mine", [0])
}

describe("StakeWeightedAllocationPolicy", (): void => {
    const [
        admin,
        broker,
        broker2,
        broker3,
        trustedForwarder
    ] = waffleProvider.getWallets()

    let bountyFactory: BountyFactory
    let token: TestToken
    let bountyTemplate: Bounty
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let allocationPolicy: IAllocationPolicy
    let leavePolicy: ILeavePolicy

    before(async (): Promise<void> => {
        token = await (await getContractFactory("TestToken", admin)).deploy("TestToken", "TEST") as TestToken
        await token.deployed()

        minStakeJoinPolicy = await (await getContractFactory("MinimumStakeJoinPolicy", admin)).deploy() as IJoinPolicy
        await minStakeJoinPolicy.deployed()

        maxBrokersJoinPolicy = await (await getContractFactory("MaxAmountBrokersJoinPolicy", admin)).deploy() as IJoinPolicy
        await maxBrokersJoinPolicy.deployed()

        allocationPolicy = await (await getContractFactory("StakeWeightedAllocationPolicy", admin)).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()

        leavePolicy = await (await getContractFactory("DefaultLeavePolicy", admin)).deploy() as ILeavePolicy
        await leavePolicy.deployed()

        bountyTemplate = await (await getContractFactory("Bounty")).deploy() as Bounty
        await bountyTemplate.deployed()

        const bountyFactoryFactory = await getContractFactory("BountyFactory", admin)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ bountyTemplate.address, trustedForwarder.address, token.address ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory

        await (await token.mint(admin.address, parseEther("2000000"))).wait()
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
        await (await token.transfer(broker3.address, parseEther("100000"))).wait()
    })

    async function deployBountyContract({
        minBrokerCount = 1, // bounty will start paying out as soon as one broker joins
        minHorizonSeconds = 200000, // this ensures that leaving doesn't incur stake penalties
        allocationWeiPerSecond = parseEther("1"),
    } = {}): Promise<Bounty> {
        const bountyDeployTx = await bountyFactory.deployBountyAgreement(
            minHorizonSeconds.toString(),
            minBrokerCount.toString(),
            "Bounty-" + Date.now()
        )
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
        const newBountyAddress = newBountyEvent?.args?.bountyContract
        expect(newBountyAddress).not.to.be.undefined
        log("Bounty deployed at %s", newBountyAddress)

        const bounty = bountyTemplate.attach(newBountyAddress)

        const setAllocationPolicyTx = await bounty.setAllocationPolicy(allocationPolicy.address, allocationWeiPerSecond)
        await setAllocationPolicyTx.wait()
        const setJoinPolicyTx = await bounty.addJoinPolicy(minStakeJoinPolicy.address, parseEther("1"))
        await setJoinPolicyTx.wait()
        const setLeavelPolicyTx = await bounty.setLeavePolicy(leavePolicy.address, "0")
        await setLeavelPolicyTx.wait()

        await (await token.approve(newBountyAddress, parseEther("100000"))).wait()

        return bounty
    }

    it("allocates correctly for single broker (positive test)", async () => {
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("10000"))).wait()
        const balanceBefore = await token.balanceOf(broker.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 1000) + 1) * 1000

        await advanceToTimestamp(timeAtStart, "broker joins")
        // this tx this happens at timeAtStart + 1
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        const allocationAfterJoin = await bounty.getAllocation(broker.address)
        const stakeAfterJoin = await bounty.getStake(broker.address)

        await advanceToTimestamp(timeAtStart + 21, "broker leaves")
        const allocationAfter20 = await bounty.getAllocation(broker.address)

        await advanceToTimestamp(timeAtStart + 51, "broker leaves")
        const allocationAfter50 = await bounty.getAllocation(broker.address)

        await advanceToTimestamp(timeAtStart + 100, "broker leaves")
        // this getter happens at timeAtStart + 100
        // but this tx happens at timeAtStart + 101...
        await (await bounty.connect(broker).leave()).wait()
        const allocationBeforeLeave = await bounty.getAllocation(broker.address)
        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)

        // broker now has his stake back plus additional winnings
        expect(formatEther(allocationAfterJoin)).to.equal("0.0")
        expect(formatEther(allocationAfter20)).to.equal("20.0")
        expect(formatEther(allocationAfter50)).to.equal("50.0")
        expect(formatEther(allocationBeforeLeave)).to.equal("100.0") // ...hence this will show 99 instead of 100
        expect(formatEther(balanceChange)).to.equal("100.0") // ...this however is correct because both tx are "1 second late"
        expect(formatEther(stakeAfterJoin)).to.equal("1000.0")
    })

    it("allocates correctly for two brokers, same weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : broker1 joins
        // t1 = t0 + 1000: broker2 joins
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + half-of-half = 75% of the winnings
        // broker2 should have half-of-half = 25% of the winnings
        const bounty = await deployBountyContract()
        const sponsorshipWei = parseEther("10000")
        await (await token.transferAndCall(bounty.address, sponsorshipWei, "0x")).wait() // sponsor using ERC677
        const totalTokensExpected = parseEther("4000")

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const unallocatedWeiBefore = await bounty.getUnallocatedWei() as BigNumber
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        await advanceToTimestamp(timeAtStart, "broker1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "broker2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "broker2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "broker1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const unallocatedWeiAfter = await bounty.getUnallocatedWei() as BigNumber
        const tokensBroker1Expected = totalTokensExpected.div(4).mul(3)
        const tokensBroker2Expected = totalTokensExpected.div(4)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
        expect(unallocatedWeiBefore.toString()).to.equal(sponsorshipWei.toString())
        expect(unallocatedWeiAfter.toString()).to.equal(sponsorshipWei.sub(totalTokensExpected).toString())
    })

    it("allocates correctly for two brokers, different weight, different join, leave times (positive test)", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t3 = t0 + 3000: broker2 leaves (stayed for half the time)
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are winnings
        // broker1 should have half + 20% of half = 60% of the winnings
        // broker2 should have 80% of half = 40% of the winnings
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("100000"))).wait()
        const totalTokensExpected = parseEther("4000")

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("4"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(60)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(40)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    it("allocates correctly for two brokers, different weight, with adding additional stake", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1 (1 : 0)
        // t1 = t0 + 2000: broker2 joins, stakes 1 (1 : 1)
        // t2 = t0 + 4000: broker1 adds 3 stake => (4 : 1)
        // t3 = t0 + 6000: broker2 adds 3 stake => (4 : 4)
        // t4 = t0 + 8000: broker2 leaves       => (4 : 0)
        // t5 = t0 +10000: broker1 leaves       => (0 : 0)
        // broker1 should have 20% + 10% + 16% + 10% + 20% = 76% of the winnings
        // broker2 should have  0% + 10% +  4% + 10% +  0% = 24% of the winnings
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("100000"))).wait()
        const totalTokensExpected = parseEther("10000")

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 adds stake 1 -> 4")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("3"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 6000, "Broker 2 adds stake 1 -> 4")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("3"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 8000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        await advanceToTimestamp(timeAtStart + 10000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(76)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(24)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    it("allocates correctly if money runs out", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1
        // t1 = t0 + 1000: broker2 joins, stakes 4
        // t2 = t0 + 2000: money runs out
        // t3 = t0 + 3000: broker2 leaves
        // t4 = t0 + 4000: broker1 leaves
        // in the end 4000*(wei/sec) are expected winnings i.e. owed to brokers
        //            but only half actually allocated and paid out
        // broker1 should have half * (half + 20% of half) = 30% of the expected winnings
        // broker2 should have half * (80% of half) = 20% of the expected winnings
        const bounty = await deployBountyContract()
        const totalTokensExpected = parseEther("4000")
        await (await bounty.sponsor(totalTokensExpected.div(2))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(
            bounty.address,
            parseEther("1000"),
            broker.address
        )).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(
            bounty.address,
            parseEther("4000"),
            broker2.address
        ) as ContractTransaction).wait()

        // timeAtStart + 2001: money runs out (+1 because joins happen at +1)

        await advanceToTimestamp(timeAtStart + 3000, "Broker 2 leaves")
        const leave2Tr = await (await bounty.connect(broker2).leave() as ContractTransaction).wait()
        const insolvencyEvent = leave2Tr.events?.find((e) => e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave() as ContractTransaction).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(100).mul(30)
        const tokensBroker2Expected = totalTokensExpected.div(100).mul(20)

        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
        expect(insolvencyEvent).to.not.be.undefined
    })

    it("allocates correctly if money runs out, and then money is added", async function(): Promise<void> {
        //      t0       : broker1 joins, stakes 1000 tokens
        // t1 = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t2 = t0 + 2000: money runs out
        // t3 = t0 + 3000: money is added
        // t4 = t0 + 4000: broker2 leaves
        // t5 = t0 + 5000: broker1 leaves
        // in the end 4000*(wei/sec) are expected winnings i.e. owed to brokers
        //            because between 2000...3000 no allocations were paid
        // broker1 should have half + half of half = 75% of the winnings
        // broker2 should have half of half = 25% of the winnings
        const bounty = await deployBountyContract()
        const totalTokensExpected = parseEther("4000")
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        const tokensBroker1Actual = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2Actual = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)
        const tokensBroker1Expected = totalTokensExpected.div(4).mul(3)
        const tokensBroker2Expected = totalTokensExpected.div(4)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1000").div("2000").toString(),     // 2000 full token total stake
            parseEther("1000").toString()
        ])
        expect(tokensBroker1Actual.toString()).to.equal(tokensBroker1Expected.toString())
        expect(tokensBroker2Actual.toString()).to.equal(tokensBroker2Expected.toString())
    })

    it("allocates correctly if broker joins during insolvency", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker2 joins, stakes 1000 tokens
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker1 leaves
        // t = t0 + 5000: broker2 leaves
        // seconds between 0...1000...2000...3000...4000...5000  total
        // broker1 gets     1000   + 0    + 0   + 500    + 0    = 1500
        // broker2 gets        0   + 0    + 0   + 500 + 1000    = 1500
        // forfeited tokens          1000 + 1000                = 2000
        // forfeited per stake       1    + 0.5                 = 1.5
        // this means: if there wouldn't have been insolvency:
        //   brokers would've gotten 2000 tokens more, i.e. 3000 + 2000 tokens
        //   broker1 would've gotten 1.5 more per stake, i.e. 1500 + 1.5*1000 tokens (since it was joined all through the insolvency)
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 1001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1.5").toString(),
            parseEther("2000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")
    })

    it("allocates correctly if broker leaves during insolvency", async function(): Promise<void> {
        //     t0       : broker joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker leaves
        // expecting to get 1000 tokens and forfeiting 1000
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker leaves")
        const leaveTr = await (await bounty.connect(broker).leave()).wait()
        const insolvencyEvent = leaveTr.events?.find((e) => e.event == "InsolvencyStarted")

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

        // event InsolvencyStarted(uint startTimeStamp);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toNumber())).to.deep.equal([timeAtStart + 1001])
        expect(formatEther(newTokens)).to.equal("1000.0")
    })

    // TODO: this test will change once the bounty will stop allocations with too few brokers, see assert in the end
    it.skip("allocates correctly if the ONLY broker joins and leaves during insolvency", async function(): Promise<void> {
        // t = t0       : broker joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: broker leaves
        // t = t0 + 3000: broker joins
        // t = t0 + 4000: money added
        // t = t0 + 5000: broker leaves
        // expecting to get 1000 + 1000 tokens and also forfeiting 1000 + 1000
        //   (although forfeited tokens can't be read from anywhere because broker didn't stay through insolvency!)
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Broker joins again")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 5000, "Broker leaves")
        await (await bounty.connect(broker).leave()).wait()

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 1001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 4001).toString(),
            // TODO: not sure what these should be?! Eventually the contract shouldn't run when there are not brokers, and this should be 2000
            parseEther("2").toString(),
            parseEther("2000").toString()
        ])
        expect(formatEther(newTokens)).to.equal("2000.0")
    })

    it("allocates correctly if a broker leaves then joins during insolvency", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker1 joins, stakes 1000 tokens
        // t = t0 + 5000: money is added
        // t = t0 + 6000: broker1 leaves
        // t = t0 + 7000: broker2 leaves
        // seconds between 0...1000...2000...3000...4000...5000...6000...7000  total
        // broker1 gets     1000 + 500 +   0  +   0  +   0  +  500 +    0     = 2000
        // broker2 gets        0 + 500 +   0  +   0  +   0  +  500 + 1000     = 2000
        // forfeited tokens             1000 + 1000  + 1000                   = 3000
        // forfeited per stake           0.5 +  1.0  + 0.5                    = 2.0
        // this means: if there wouldn't have been insolvency:
        //   brokers would've gotten 3000 tokens more, i.e. 4000 + 3000 tokens
        //   broker2 would've gotten 2.0 more per stake, i.e. 2000 + 2.0*1000 tokens (since it was joined all through the insolvency)
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 joins again")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 6000, "Broker 1 leaves again")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 7000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 5001).toString(),
            parseEther("2.0").toString(),
            parseEther("3000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("2000.0")
        expect(formatEther(tokensBroker2)).to.equal("2000.0")
    })

    it("allocates correctly if incomePerSecond changes", async function(): Promise<void> {
        //     t0       : broker joins
        // t = t0 + 1000: incomePerSecond changes to 2
        // t = t0 + 2000: broker leaves
        // expecting to get 1000 + 2000 tokens
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("10000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "IncomePerSecond changes")
        await (await bounty.setAllocationPolicy(allocationPolicy.address, parseEther("2"))).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Broker leaves")
        await (await bounty.connect(broker).leave()).wait()

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

        expect(formatEther(newTokens)).to.equal("3000.0")
    })

    it("allocates correctly if incomePerSecond changes during insolvency", async function(): Promise<void> {
        //     t0       : broker joins
        // t = t0 + 1000: money runs out
        // t = t0 + 2000: incomePerSecond changes to 2
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker leaves
        // expecting to get 1000 + 2000 tokens
        // expecting 1000 + 2000 forfeited tokens (1.0 + 2.0 per stake)
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBefore = await token.balanceOf(broker.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out (+1 because all tx happen one second "late" in test env)

        await advanceToTimestamp(timeAtStart + 2000, "IncomePerSecond changes")
        await (await bounty.setAllocationPolicy(allocationPolicy.address, parseEther("2"))).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker leaves")
        await (await bounty.connect(broker).leave()).wait()

        const newTokens = (await token.balanceOf(broker.address)).sub(tokensBefore)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 1001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("3.0").toString(),
            parseEther("3000").toString()
        ])
        expect(formatEther(newTokens)).to.equal("3000.0")
    })

    it("allocates correctly if money runs out exactly during join", async function(): Promise<void> {
        // t = t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins while money runs out
        // t = t0 + 2000: money is added
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker2 leaves
        // broker1 should get 1000 +  500 tokens
        // broker2 should get    0 + 1500 tokens
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("1000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        // timeAtStart + 1001: money runs out AND broker2 joins
        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 1001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 2001).toString(),
            parseEther("0.5").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during leave", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND broker1 leaves
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker2 leaves
        // broker1 should have 1000 + 500 tokens
        // broker2 should have 500 + 1000 tokens
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)
        await advanceToTimestamp(timeAtStart + 2000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1.0").toString(),
            parseEther("1000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("1500.0")
        expect(formatEther(tokensBroker2)).to.equal("1500.0")
    })

    it("allocates correctly if money runs out exactly during top-up (and emits no insolvency event)", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND money is added
        // t = t0 + 3000: broker1 leaves
        // t = t0 + 4000: broker2 leaves
        // broker1 should have 1000 + 500 + 500 +    0 = 2000 tokens
        // broker2 should have    0 + 500 + 500 + 1000 = 2000 tokens
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)
        await advanceToTimestamp(timeAtStart + 2000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 3000, "Broker 1 leaves")
        const tr2 = await (await bounty.connect(broker).leave()).wait()
        const insolvencyEvent2 = tr2.events?.find((e) => e.event == "InsolvencyEnded" || e.event == "InsolvencyStarted")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        expect(insolvencyEvent).to.be.undefined
        expect(insolvencyEvent2).to.be.undefined
        expect(formatEther(tokensBroker1)).to.equal("2000.0")
        expect(formatEther(tokensBroker2)).to.equal("2000.0")
    })

    it("allocates correctly if money runs out exactly during incomePerSecond change", async function(): Promise<void> {
        //     t0       : broker1 joins, stakes 1000 tokens
        // t = t0 + 1000: broker2 joins, stakes 1000 tokens
        // t = t0 + 2000: money runs out AND incomePerSecond changes to 2
        // t = t0 + 3000: money is added
        // t = t0 + 4000: broker1 leaves
        // t = t0 + 5000: broker2 leaves
        // broker1 should have 1000 + 500 + 1000 +    0 = 2500 tokens
        // broker2 should have    0 + 500 + 1000 + 2000 = 3500 tokens
        const bounty = await deployBountyContract()
        await (await bounty.sponsor(parseEther("2000"))).wait()

        const tokensBroker1Before = await token.balanceOf(broker.address)
        const tokensBroker2Before = await token.balanceOf(broker2.address)
        const timeAtStart = Math.floor(((await provider.getBlock("latest")).timestamp / 100000) + 1) * 100000

        await advanceToTimestamp(timeAtStart, "Broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()

        await advanceToTimestamp(timeAtStart + 1000, "Broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()

        // timeAtStart + 2001: money runs out (+1 because all tx happen one second "late" in test env)
        await advanceToTimestamp(timeAtStart + 2000, "Money runs out AND incomePerSecond changes to 2")
        await (await bounty.setAllocationPolicy(allocationPolicy.address, parseEther("2"))).wait()

        await advanceToTimestamp(timeAtStart + 3000, "Money is added")
        const tr = await (await bounty.sponsor(parseEther("10000"))).wait()
        const insolvencyEvent = tr.events?.find((e) => e.event == "InsolvencyEnded")

        await advanceToTimestamp(timeAtStart + 4000, "Broker 1 leaves")
        await (await bounty.connect(broker).leave()).wait()

        await advanceToTimestamp(timeAtStart + 5000, "Broker 2 leaves")
        await (await bounty.connect(broker2).leave()).wait()

        const tokensBroker1 = (await token.balanceOf(broker.address)).sub(tokensBroker1Before)
        const tokensBroker2 = (await token.balanceOf(broker2.address)).sub(tokensBroker2Before)

        // event InsolvencyEnded(uint startTimeStamp, uint endTimeStamp, uint forfeitedWeiPerStake, uint forfeitedWei);
        expect(insolvencyEvent?.args?.map((a: BigNumber) => a.toString())).to.deep.equal([
            (timeAtStart + 2001).toString(), // +1 because all tx happen one second "late" in test env
            (timeAtStart + 3001).toString(),
            parseEther("1.0").toString(),
            parseEther("2000").toString()
        ])
        expect(formatEther(tokensBroker1)).to.equal("2500.0")
        expect(formatEther(tokensBroker2)).to.equal("3500.0")
    })

    // TODO: add required staying period feature, then unskip this test
    it.skip("deducts penalty from a broker that leaves too early", async function(): Promise<void> {
        const bounty = await deployBountyContract()

        await (await token.connect(broker).transfer(admin.address, await token.balanceOf(broker.address))).wait()
        await (await token.transfer(broker.address, parseEther("10"))).wait()
        const tokensBefore = await token.balanceOf(broker.address)

        await token.approve(bounty.address, parseEther("1"))
        await bounty.sponsor(parseEther("1"))

        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()

        await (await bounty.connect(broker).leave()).wait()
        const tokensAfter = await token.balanceOf(broker.address)

        // TODO: why should this happen?
        // broker lost 10% of his stake
        expect(formatEther(tokensBefore.sub(parseEther("0.1")))).to.equal(formatEther(tokensAfter))
    })

    it("gets allocation 0 from unjoined broker", async function(): Promise<void> {
        const bounty = await deployBountyContract()
        const allocation = await bounty.getAllocation(broker.address)
        expect(allocation.toString()).to.equal("0")
    })
})

import { waffle, upgrades, ethers as hardhatEthers } from "hardhat"
import { expect, use } from "chai"
import { utils } from "ethers"

import type { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy } from "../typechain"
import { TestToken } from "../typechain/TestToken"

const { provider: waffleProvider } = waffle
const { parseEther, formatEther } = utils
const { provider, getContractFactory } = hardhatEthers

const { log } = console

use(waffle.solidity)

async function advanceToTimestamp(timestamp: number, message?: string) {
    // log("\nt = %s ", timestamp, message ?? "")
    await provider.send("evm_setNextBlockTimestamp", [timestamp])
    await provider.send("evm_mine", [0])
}

enum State {
    NotInitialized,
    Closed,     // horizon < minHorizon and brokerCount fallen below minBrokerCount
    Warning,    // brokerCount > minBrokerCount, but horizon < minHorizon ==> brokers can leave without penalty
    Funded,     // horizon > minHorizon, but brokerCount still below minBrokerCount
    Running     // horizon > minHorizon and minBrokerCount <= brokerCount <= maxBrokerCount
}

describe("DefaultLeavePolicy", (): void => {
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

        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()
        await (await token.transfer(broker3.address, parseEther("100000"))).wait()
    })

    async function deployBountyContract({
        minBrokerCount = 2,
        minHorizonSeconds = 3600,
        allocationWeiPerSecond = parseEther("1"),
    } = {}): Promise<Bounty> {
        const bountyDeployTx = await bountyFactory.deployBountyAgreement(
            minHorizonSeconds.toString(),
            minBrokerCount.toString(),
            "Bounty-" + Date.now(),
            [minStakeJoinPolicy.address], [parseEther("1")], allocationPolicy.address, allocationWeiPerSecond,
            leavePolicy.address, "0"
        )
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyEvent = bountyDeployReceipt.events?.find((e) => e.event === "NewBounty")
        const newBountyAddress = newBountyEvent?.args?.bountyContract
        expect(newBountyAddress).not.to.be.undefined
        // log("Bounty deployed at %s", newBountyAddress)

        const bounty = bountyTemplate.attach(newBountyAddress)

        await (await token.approve(newBountyAddress, parseEther("100000"))).wait()

        return bounty
    }

    it("penalizes only from the broker that leaves early while bounty is running", async function(): Promise<void> {
        const bounty = await deployBountyContract()
        expect(await bounty.getState()).to.equal(State.Closed)

        await bounty.sponsor(parseEther("10000"))
        expect(await bounty.getState()).to.equal(State.Funded)

        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1
        const balanceBefore = await token.balanceOf(broker.address)
        const balanceBefore2 = await token.balanceOf(broker2.address)

        await advanceToTimestamp(timeAtStart, "broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        await advanceToTimestamp(timeAtStart + 100, "broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()
        expect(await bounty.getState()).to.equal(State.Running)

        await advanceToTimestamp(timeAtStart + 300, "broker 1 leaves while bounty is running")
        await (await bounty.connect(broker).leave()).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        await advanceToTimestamp(timeAtStart + 400, "broker 2 leaves when bounty is stopped")
        await (await bounty.connect(broker2).leave()).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)
        const balanceChange2 = (await token.balanceOf(broker2.address)).sub(balanceBefore2)

        expect(formatEther(balanceChange)).to.equal("-800.0")
        expect(formatEther(balanceChange2)).to.equal("200.0")
    })

    it("doesn't penalize a broker that leaves after the leave period", async function(): Promise<void> {
        // time:        0 ... 400 ... 1000 ... 1700
        // join/leave: +b1    +b2      -b1      -b2
        // broker1:       400  +  300               =  700
        // broker2:               300  +  700       = 1000
        const bounty = await deployBountyContract()
        expect(await bounty.getState()).to.equal(State.Closed)

        await bounty.sponsor(parseEther("10000"))
        expect(await bounty.getState()).to.equal(State.Funded)

        const timeAtStart = (await provider.getBlock("latest")).timestamp + 1
        const balanceBefore = await token.balanceOf(broker.address)
        const balanceBefore2 = await token.balanceOf(broker2.address)

        await advanceToTimestamp(timeAtStart, "broker 1 joins")
        await (await token.connect(broker).transferAndCall(bounty.address, parseEther("1000"), broker.address)).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        await advanceToTimestamp(timeAtStart + 400, "broker 2 joins")
        await (await token.connect(broker2).transferAndCall(bounty.address, parseEther("1000"), broker2.address)).wait()
        expect(await bounty.getState()).to.equal(State.Running)

        await advanceToTimestamp(timeAtStart + 1000, "broker 1 leaves while bounty is running")
        await (await bounty.connect(broker).leave()).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        await advanceToTimestamp(timeAtStart + 1700, "broker 2 leaves when bounty is stopped")
        await (await bounty.connect(broker2).leave()).wait()
        expect(await bounty.getState()).to.equal(State.Funded)

        const balanceChange = (await token.balanceOf(broker.address)).sub(balanceBefore)
        const balanceChange2 = (await token.balanceOf(broker2.address)).sub(balanceBefore2)

        expect(formatEther(balanceChange)).to.equal("700.0")
        expect(formatEther(balanceChange2)).to.equal("1000.0")
    })
})

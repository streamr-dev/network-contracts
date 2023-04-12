import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { defaultAbiCoder, parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deployBounty } from "./deployBounty"
import { deployBrokerPool } from "./deployBrokerPool"

let bountyCounter = 0

describe("BountyFactory", () => {
    let admin: Wallet
    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    it("can deploy a Bounty; then BrokerPool can join, increase stake (happy path)", async function(): Promise<void> {
        const { token } = contracts
        const bounty = await deployBounty(contracts)
        const pool = await deployBrokerPool(contracts, admin)
        await (await token.mint(pool.address, parseEther("200"))).wait()
        await expect(pool.stake(bounty.address, parseEther("200")))
            .to.emit(bounty, "BrokerJoined").withArgs(pool.address)
        await expect(pool.stake(bounty.address, parseEther("200")))
            .to.not.emit(bounty, "BrokerJoined")
    })

    it("can create a Bounty with transferAndCall (atomic fund and deploy bounty)", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, bountyFactory, token } = contracts

        // uint initialMinimumStakeWei,
        // uint32 initialMinHorizonSeconds,
        // uint32 initialMinBrokerCount,
        // string memory bountyName,
        // address[] memory policies,
        // uint[] memory initParams
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        const bountyDeployTx = await token.transferAndCall(bountyFactory.address, parseEther("100"), data)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        expect(newBountyAddress).to.be.not.undefined
    })

    it("will NOT create a Bounty with zero minBrokerCount", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, bountyFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [parseEther("100"), 0, 0, "Bounty-" + bountyCounter++, "metadata", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(bountyFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minBrokerCountZero")
    })

    it("will NOT create a Bounty with zero minimumStake", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, bountyFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [0, 0, 1, "Bounty-" + bountyCounter++, "metadata", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(bountyFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minimumStakeTooLow")
    })

    it("will NOT create a Bounty with a minimumStake < minimumStakeWei", async function(): Promise<void> {
        const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
        const { allocationPolicy, leavePolicy, bountyFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei.sub(1), 0, 1, "Bounty-" + bountyCounter++, "metadata", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(bountyFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minimumStakeTooLow")

        const data2 = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei, 0, 1, "Bounty-" + bountyCounter++, "metadata", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(bountyFactory.address, parseEther("100"), data2))
            .to.not.be.reverted
    })

    it("will NOT create a Bounty with untrusted policies", async function(): Promise<void> {
        const { bountyFactory, allocationPolicy, leavePolicy, maxBrokersJoinPolicy } = contracts
        /**
         * Policies array is interpreted as follows:
         *   0: allocation policy (address(0) for none)
         *   1: leave policy (address(0) for none)
         *   2: kick policy (address(0) for none)
         *   3+: join policies (leave out if none)
         */
        const untrustedAddress = "0x1234567890123456789012345678901234567890"
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        // allocationpolicy
        await expect(bountyFactory.deployBounty(parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata",
            [untrustedAddress, leavePolicy.address, kickPolicyAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // leavepolicy
        await expect(bountyFactory.deployBounty(parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata",
            [allocationPolicy.address, untrustedAddress, kickPolicyAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // kickpolicy
        await expect(bountyFactory.deployBounty(parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, untrustedAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // joinpolicy
        await expect(bountyFactory.deployBounty(parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
    })

    it("will NOT create a Bounty with mismatching number of policies and params", async function(): Promise<void> {
        const { bountyFactory, allocationPolicy, leavePolicy } = contracts
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(bountyFactory.deployBounty(parseEther("100"), 0, 1, "Bounty-" + bountyCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    // must be last test, will remove all policies in the bountyFactory
    it("positivetest remove trusted policies", async function(): Promise<void> {
        const { bountyFactory, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, leavePolicy } = contracts
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await bountyFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.true
        await (await bountyFactory.removeTrustedPolicy(maxBrokersJoinPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await bountyFactory.removeTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).wait()
        expect(await bountyFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await bountyFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.false
    })
})

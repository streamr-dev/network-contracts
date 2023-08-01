import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { defaultAbiCoder, parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "./deploySponsorshipContract"
import { deployOperatorContract } from "./deployOperatorContract"
import { StreamRegistryV4 } from "../../../typechain"

let sponsorshipCounter = 0

async function createStream(deployerAddress: string, streamRegistry: StreamRegistryV4): Promise<string> {
    const streamPath = "/sponsorships/" + sponsorshipCounter++
    const streamId = deployerAddress.toLowerCase() + streamPath
    await (await streamRegistry.createStream(streamPath, streamId)).wait()
    return streamId
}

describe("SponsorshipFactory", () => {
    let admin: Wallet
    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    it("can deploy a Sponsorship; then Operator can join, increase stake (happy path)", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorship(contracts)
        const pool = await deployOperatorContract(contracts, admin)
        await (await token.mint(pool.address, parseEther("400"))).wait()
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.emit(sponsorship, "OperatorJoined").withArgs(pool.address)
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.not.emit(sponsorship, "OperatorJoined")
    })

    it("can create a Sponsorship with transferAndCall (atomic fund and deploy sponsorship)", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts

        // uint initialMinimumStakeWei,
        // uint32 initialMinHorizonSeconds,
        // uint32 initialMinOperatorCount,
        // string memory sponsorshipName,
        // address[] memory policies,
        // uint[] memory initParams
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [1, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        const sponsorshipDeployTx = await token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data)
        const sponsorshipDeployReceipt = await sponsorshipDeployTx.wait()
        const newSponsorshipAddress = sponsorshipDeployReceipt.events?.filter((e) => e.event === "Transfer")[1]?.args?.to
        const newSponsorshipLog = sponsorshipDeployReceipt.logs.find((e) => e.address == sponsorshipFactory.address)
        if (!newSponsorshipLog) { throw new Error("NewSponsorship event not found") }  // typescript can't infer not-undefined from expect
        const newSponsorshipEvent = sponsorshipFactory.interface.parseLog(newSponsorshipLog)
        expect(newSponsorshipAddress).to.be.not.undefined
        expect(newSponsorshipEvent.name).to.equal("NewSponsorship")
        expect(newSponsorshipEvent.args.creator).to.equal(admin.address)
        expect(newSponsorshipEvent.args.sponsorshipContract).to.equal(newSponsorshipAddress)
        expect(newSponsorshipEvent.args.metadata).to.equal("{}")
        expect(newSponsorshipEvent.args.streamId).to.equal(streamId)
    })

    it("will NOT create a Sponsorship with zero minOperatorCount", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [0, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minOperatorCountZero")
    })

    // minimum stake is simply set to the global minimum in the factory currently, and the argument ignored
    it.skip("will NOT create a Sponsorship with zero minimumStake", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [1, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minimumStakeTooLow")
    })

    // minimum stake is simply set to the global minimum in the factory currently, and the argument ignored
    it.skip("will NOT create a Sponsorship with a minimumStake < minimumStakeWei", async function(): Promise<void> {
        const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const data = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei.sub(1), 0, 1, streamId, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data))
            .to.be.revertedWith("error_minimumStakeTooLow")

        const streamId2 = await createStream(deployer.address, streamRegistry)
        const data2 = defaultAbiCoder.encode(["uint", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei, 0, 1, streamId2, "{}", [
                allocationPolicy.address,
                leavePolicy.address,
                "0x0000000000000000000000000000000000000000",
            ], [
                "2000000000000000000",
                "0",
                "0",
            ]]
        )
        await expect(token.transferAndCall(sponsorshipFactory.address, parseEther("100"), data2))
            .to.not.be.reverted
    })

    it("will NOT create a Sponsorship with untrusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, maxOperatorsJoinPolicy, deployer, streamRegistry } = contracts
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
        const streamId1 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId1, "{}",
            [untrustedAddress, leavePolicy.address, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // leavepolicy
        const streamId2 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId2, "{}",
            [allocationPolicy.address, untrustedAddress, kickPolicyAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // kickpolicy
        const streamId3 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId3, "{}",
            [allocationPolicy.address, leavePolicy.address, untrustedAddress, maxOperatorsJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // joinpolicy
        const streamId4 = await createStream(deployer.address, streamRegistry)
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId4, "{}",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
    })

    it("will NOT create a Sponsorship with mismatching number of policies and params", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, deployer, streamRegistry } = contracts
        const streamId = await createStream(deployer.address, streamRegistry)
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, streamId, "{}",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    it("will NOT create a Sponsorship if the stream does not exist", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy, voteKickPolicy } = contracts
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "0xnonexistingstreamid", "{}",
            [allocationPolicy.address, leavePolicy.address, voteKickPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_streamNotFound")
    })

    // must be last test, will remove all policies in the sponsorshipFactory
    it("positivetest remove trusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, maxOperatorsJoinPolicy, operatorContractOnlyJoinPolicy, allocationPolicy, leavePolicy } = contracts
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.true
        await (await sponsorshipFactory.removeTrustedPolicy(maxOperatorsJoinPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(operatorContractOnlyJoinPolicy.address)).wait()
        expect(await sponsorshipFactory.isTrustedPolicy(maxOperatorsJoinPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(operatorContractOnlyJoinPolicy.address)).to.be.false
    })
})

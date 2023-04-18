import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { utils as ethersUtils, Wallet } from "ethers"

const { defaultAbiCoder, parseEther } = ethersUtils
const { getSigners } = hardhatEthers

import { deployTestContracts, TestContracts } from "./deployTestContracts"
import { deploySponsorship } from "./deploySponsorship"
import { deployBrokerPool } from "./deployBrokerPool"

let sponsorshipCounter = 0

describe("SponsorshipFactory", () => {
    let admin: Wallet
    let contracts: TestContracts

    before(async (): Promise<void> => {
        [admin] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        const { token } = contracts
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
    })

    it("can deploy a Sponsorship; then BrokerPool can join, increase stake (happy path)", async function(): Promise<void> {
        const { token } = contracts
        const sponsorship = await deploySponsorship(contracts)
        const pool = await deployBrokerPool(contracts, admin)
        await (await token.mint(pool.address, parseEther("200"))).wait()
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.emit(sponsorship, "BrokerJoined").withArgs(pool.address)
        await expect(pool.stake(sponsorship.address, parseEther("200")))
            .to.not.emit(sponsorship, "BrokerJoined")
    })

    it("can create a Sponsorship with transferAndCall (atomic fund and deploy sponsorship)", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token } = contracts

        // uint initialMinimumStakeWei,
        // uint32 initialMinHorizonSeconds,
        // uint32 initialMinBrokerCount,
        // string memory sponsorshipName,
        // address[] memory policies,
        // uint[] memory initParams
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata", [
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
        expect(newSponsorshipAddress).to.be.not.undefined
    })

    it("will NOT create a Sponsorship with zero minBrokerCount", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [parseEther("100"), 0, 0, "Sponsorship-" + sponsorshipCounter++, "metadata", [
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
            .to.be.revertedWith("error_minBrokerCountZero")
    })

    it("will NOT create a Sponsorship with zero minimumStake", async function(): Promise<void> {
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [0, 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata", [
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

    it("will NOT create a Sponsorship with a minimumStake < minimumStakeWei", async function(): Promise<void> {
        const minimumStakeWei = await contracts.streamrConfig.minimumStakeWei()
        const { allocationPolicy, leavePolicy, sponsorshipFactory, token } = contracts
        const data = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei.sub(1), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata", [
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

        const data2 = defaultAbiCoder.encode(["uint", "uint32", "uint32", "string", "string", "address[]", "uint[]"],
            [minimumStakeWei, 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata", [
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
        const { sponsorshipFactory, allocationPolicy, leavePolicy, maxBrokersJoinPolicy } = contracts
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
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata",
            [untrustedAddress, leavePolicy.address, kickPolicyAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // leavepolicy
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata",
            [allocationPolicy.address, untrustedAddress, kickPolicyAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // kickpolicy
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, untrustedAddress, maxBrokersJoinPolicy.address],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
        // joinpolicy
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress, untrustedAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_policyNotTrusted")
    })

    it("will NOT create a Sponsorship with mismatching number of policies and params", async function(): Promise<void> {
        const { sponsorshipFactory, allocationPolicy, leavePolicy } = contracts
        const kickPolicyAddress = "0x0000000000000000000000000000000000000000"
        await expect(sponsorshipFactory.deploySponsorship(parseEther("100"), 0, 1, "Sponsorship-" + sponsorshipCounter++, "metadata",
            [allocationPolicy.address, leavePolicy.address, kickPolicyAddress],
            ["0", "0", "0", "0"])).to.be.revertedWith("error_badArguments")
    })

    // must be last test, will remove all policies in the sponsorshipFactory
    it("positivetest remove trusted policies", async function(): Promise<void> {
        const { sponsorshipFactory, maxBrokersJoinPolicy, brokerPoolOnlyJoinPolicy, allocationPolicy, leavePolicy } = contracts
        expect(await sponsorshipFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.true
        expect(await sponsorshipFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.true
        await (await sponsorshipFactory.removeTrustedPolicy(maxBrokersJoinPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(allocationPolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(leavePolicy.address)).wait()
        await (await sponsorshipFactory.removeTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).wait()
        expect(await sponsorshipFactory.isTrustedPolicy(maxBrokersJoinPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(allocationPolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(leavePolicy.address)).to.be.false
        expect(await sponsorshipFactory.isTrustedPolicy(brokerPoolOnlyJoinPolicy.address)).to.be.false
    })
})

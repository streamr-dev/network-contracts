import { ethers as hardhatEthers } from "hardhat"
import { expect } from "chai"
import { Contract, utils as ethersUtils, Wallet } from "ethers"

import { Bounty, IAllocationPolicy, IJoinPolicy, TestToken } from "../../../typechain"

const { defaultAbiCoder, parseEther } = ethersUtils
const { getSigners, getContractFactory } = hardhatEthers

import {
    deployTestContracts,
    TestContracts,
} from "./deployTestContracts"

import { deployBountyContract } from "./deployBountyContract"

describe("Bounty", (): void => {
    let admin: Wallet
    let broker: Wallet
    let broker2: Wallet

    let token: TestToken

    let testJoinPolicy: IJoinPolicy
    let testAllocationPolicy: IAllocationPolicy

    let contracts: TestContracts

    // some test cases just want "any bounty", no need to deploy a new contract
    let defaultBounty: Bounty

    before(async (): Promise<void> => {
        [admin, broker, broker2] = await getSigners() as unknown as Wallet[]
        contracts = await deployTestContracts(admin)

        // TODO: fix type incompatibility, if at all possible
        const { bountyFactory } = contracts
        testAllocationPolicy = await (await getContractFactory("TestAllocationPolicy", admin)).deploy() as unknown as IAllocationPolicy
        testJoinPolicy = await (await (await getContractFactory("TestJoinPolicy", admin)).deploy()).deployed() as unknown as IJoinPolicy
        await (await bountyFactory.addTrustedPolicies([ testJoinPolicy.address, testAllocationPolicy.address])).wait()

        token = contracts.token
        await (await token.mint(admin.address, parseEther("1000000"))).wait()
        await (await token.transfer(broker.address, parseEther("100000"))).wait()
        await (await token.transfer(broker2.address, parseEther("100000"))).wait()

        defaultBounty = await deployBountyContract(contracts)
    })

    it("accepts 32 byte long address in transferAndCall data", async function(): Promise<void> {
        const bounty = await deployBountyContract(contracts)
        await (await token.transferAndCall(bounty.address, parseEther("1"), defaultAbiCoder.encode(["address"], [broker.address]))).wait()
        expect(await bounty.connect(broker).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("accepts 2-step staking: approve + stake", async function(): Promise<void> {
        const bounty = await deployBountyContract(contracts)
        await (await token.approve(bounty.address, parseEther("1"))).wait()
        await (await bounty.stake(broker.address, parseEther("1"))).wait()
        expect(await bounty.connect(broker).getMyStake()).to.be.equal(parseEther("1"))
    })

    it("will NOT let anyone call the fallback function", async function(): Promise<void> {
        await expect(admin.sendTransaction({to: defaultBounty.address})).to.be.revertedWith("error_mustBeThis")
    })

    it("will NOT let anyone join with wrong token", async function(): Promise<void> {
        const newToken = await (await (await (await getContractFactory("TestToken", admin)).deploy("Test2", "T2")).deployed())
        await (await newToken.mint(admin.address, parseEther("1000000"))).wait()
        await expect(newToken.transferAndCall(defaultBounty.address, parseEther("1"), admin.address))
            .to.be.revertedWith("error_onlyDATAToken")
    })

    it("will FAIL if sponsor called with no allowance", async function(): Promise<void> {
        expect(await token.allowance(broker.address, defaultBounty.address)).to.equal(0)
        await expect(defaultBounty.connect(broker).sponsor(parseEther("1"))).to.be.revertedWith("ERC20: transfer amount exceeds allowance")
    })

    it("will NOT let stake zero", async function(): Promise<void> {
        await expect(token.transferAndCall(defaultBounty.address, parseEther("0"), broker.address))
            .to.be.revertedWith("error_cannotStakeZero")
    })

    describe("Adding policies", (): void => {

        it("will FAIL for non-admins", async function(): Promise<void> {
            const { minStakeJoinPolicy } = contracts
            const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"
            await expect(defaultBounty.connect(broker).addJoinPolicy(minStakeJoinPolicy.address, "2000000000000000000"))
                .to.be.revertedWith(`AccessControl: account ${broker.address.toLowerCase()} is missing role ${DEFAULT_ADMIN_ROLE}`)
        })

        // TODO: is this a feature or a bug?
        it("silently fails when receives empty errors from policies", async function(): Promise<void> {
            const jpMS = await getContractFactory("TestAllocationPolicy", admin)
            const jpMSC = await jpMS.deploy() as Contract
            const testAllocPolicy = await jpMSC.connect(admin).deployed() as IAllocationPolicy
            await expect(defaultBounty.setAllocationPolicy(testAllocPolicy.address, "2"))
                .to.be.revertedWith("AccessControl: account 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266 is missing "
                + "role 0x0000000000000000000000000000000000000000000000000000000000000000")
        })
    })

    describe("IJoinPolicy negative test", (): void => {

        it("error setting param on joinpolicy", async function(): Promise<void> {
            await expect(deployBountyContract(contracts, {}, [testJoinPolicy], ["1"])) // 1 => TestJoinPolicy:setParam will revert
                .to.be.revertedWith("test-error: setting param join policy")
        })

        it("error setting param on joinpolicy no revert reason", async function(): Promise<void> {
            await expect(deployBountyContract(contracts, {}, [testJoinPolicy], ["2"])) // 2 => TestJoinPolicy:setParam will revert without reason
                .to.be.revertedWith("error_addJoinPolicyFailed")
        })

        it("error joining on joinpolicy", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [testJoinPolicy], ["0"])
            await expect(token.transferAndCall(bounty.address, 1, admin.address))
                .to.be.revertedWith("test-error: onJoin join policy")
        })

        it("error joining on joinpolicy, empty error", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [testJoinPolicy], ["0"])
            await expect(token.transferAndCall(bounty.address, 2, admin.address))
                .to.be.revertedWith("error_joinPolicyOnJoin")
        })
    })

    describe("IAllocationPolicy negative test", (): void => {

        it("error setting param on allocationPolicy", async function(): Promise<void> {
            await expect(deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "1")) // 1 => will revert in setParam
                .to.be.revertedWith("test-error: setting param allocation policy")
        })

        it("error onJoin on allocationPolicy", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "3") // 3 => onJoin will revert
            await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
                .to.be.revertedWith("test-error: onJoin allocation policy")
        })

        it("error onJoin on allocationPolicy, empty error", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "4") // 4 => onJoin will revert without reason
            await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
                .to.be.revertedWith("error_allocationPolicyOnJoin")
        })

        it("error onleave on allocationPolicy", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "5") // 5 => onLeave will revert
            await (await token.transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()
            await expect(bounty.connect(broker).leave()).to.be.revertedWith("test-error: onLeave allocation policy")
        })

        it("error onleave on allocationPolicy, empty error", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "6") // 6 => onLeave will revert without reason
            await (await token.transferAndCall(bounty.address, parseEther("1"), broker.address)).wait()
            await expect(bounty.connect(broker).leave()).to.be.revertedWith("error_brokerLeaveFailed")
        })

        it("error onstakeIncrease", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "7") // 7 => onStakeIncrease will revert
            await (await token.transferAndCall(bounty.address, parseEther("1"), admin.address)).wait()
            await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
                .to.be.revertedWith("test-error: onStakeIncrease allocation policy")
        })

        it("error onstakeIncrease, empty error", async function(): Promise<void> {
            const bounty = await deployBountyContract(contracts, {}, [], [], testAllocationPolicy, "8") // 8 => onStakeIncrease revert without reason
            await (await token.transferAndCall(bounty.address, parseEther("1"), admin.address)).wait()
            await expect(token.transferAndCall(bounty.address, parseEther("1"), admin.address))
                .to.be.revertedWith("error_stakeIncreaseFailed")
        })
    })
})
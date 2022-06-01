import { waffle, upgrades, ethers } from "hardhat"
import { expect, use } from "chai"
import { Contract, ContractFactory, utils } from "ethers"
import { signTypedMessage, TypedDataUtils } from "eth-sig-util"
import { fromRpcSig } from "ethereumjs-util"

import { Bounty, BountyFactory, IAllocationPolicy, IJoinPolicy, ILeavePolicy, DATAv2 } from "../typechain"

import ForwarderJson from '../test-contracts/MinimalForwarder.json'
import { MinimalForwarder } from "../test-contracts/MinimalForwarder"
import { deployContract } from "ethereum-waffle"
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

const { provider } = waffle
// const { defaultAbiCoder } = utils

use(waffle.solidity)

const types = {
    EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
        { name: 'chainId', type: 'uint256' },
        { name: 'verifyingContract', type: 'address' },
    ],
    ForwardRequest: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'gas', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'data', type: 'bytes' },
    ],
    Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
    ]
}
// testcases to not forget:
// - increase stake if already joined

describe("MetaTx", (): void => {
    const chainId = 31337
    const name = 'DATAv2'
    const symbol = 'DATA'
    const version = '1'

    const wallets = provider.getWallets()
    const adminWallet = wallets[0] // bountyadmin
    const brokerWallet = wallets[1]
    const trustedForwarderAddress: string = wallets[9].address
    const dataTokenAdminWallet = wallets[2]

    const owner = wallets[3]
    const spender = wallets[4]
    const permitCaller = wallets[5]

    let bountyFactoryFactory: ContractFactory
    let bountyFactory: BountyFactory
    let datav2: DATAv2
    let minStakeJoinPolicy: IJoinPolicy
    let maxBrokersJoinPolicy: IJoinPolicy
    let bountyCounter = 0
    let bountyFromAdmin: Bounty
    let bountyFromBroker: Bounty
    let allocationPolicy: Contract
    let leavePolicy: Contract
    let testJoinPolicy: Contract
    let testAllocationPolicy: Contract
    let minimalForwarder: MinimalForwarder

    async function domainSeparator (name, version, chainId, verifyingContract) {
        return '0x' + TypedDataUtils.hashStruct(
            'EIP712Domain',
            { name, version, chainId, verifyingContract },
            { EIP712Domain: types.EIP712Domain },
        ).toString('hex')
    }

    const buildData = (chainId, verifyingContract, owner, spender, value, nonce, deadline = ethers.constants.MaxUint256): TypedMessage<any>=> ({
        primaryType: 'Permit',
        types: { EIP712Domain: types.EIP712Domain, Permit: types.Permit },
        domain: { name, version, chainId, verifyingContract },
        message: { owner, spender, value, nonce, deadline },
    })

    before(async (): Promise<void> => {

        datav2 = await (await ethers.getContractFactory("DATAv2", dataTokenAdminWallet)).deploy() as DATAv2
        await datav2.deployed()
        await datav2.grantRole(await datav2.MINTER_ROLE(), dataTokenAdminWallet.address)
        await (await datav2.mint(adminWallet.address, ethers.utils.parseEther("10"))).wait()
        await (await datav2.mint(brokerWallet.address, ethers.utils.parseEther("10"))).wait()

        minStakeJoinPolicy = await (await ethers.getContractFactory("MinimumStakeJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await minStakeJoinPolicy.deployed()

        maxBrokersJoinPolicy = await (await ethers.getContractFactory("MaxAmountBrokersJoinPolicy", adminWallet)).deploy() as IJoinPolicy
        await maxBrokersJoinPolicy.deployed()

        allocationPolicy = await (await ethers.getContractFactory("StakeWeightedAllocationPolicy", adminWallet)).deploy() as IAllocationPolicy
        await allocationPolicy.deployed()

        leavePolicy = await (await ethers.getContractFactory("DefaultLeavePolicy", adminWallet)).deploy() as ILeavePolicy
        await leavePolicy.deployed()

        testJoinPolicy = await (await ethers.getContractFactory("TestJoinPolicy", adminWallet)).deploy() as Contract
        await testJoinPolicy.deployed()

        testAllocationPolicy = await (await ethers.getContractFactory("TestAllocationPolicy", adminWallet)).deploy() as Contract
        await testAllocationPolicy.deployed()

        const bountyTemplate = await (await ethers.getContractFactory("Bounty")).deploy() as Bounty
        await bountyTemplate.deployed()

        bountyFactoryFactory = await ethers.getContractFactory("BountyFactory", adminWallet)
        const bountyFactoryFactoryTx = await upgrades.deployProxy(bountyFactoryFactory,
            [ bountyTemplate.address, trustedForwarderAddress, datav2.address ])
        bountyFactory = await bountyFactoryFactoryTx.deployed() as BountyFactory
        await (await bountyFactory.addTrustedPolicies([minStakeJoinPolicy.address, maxBrokersJoinPolicy.address,
            allocationPolicy.address, leavePolicy.address, testJoinPolicy.address, testAllocationPolicy.address])).wait()

        minimalForwarder = await deployContract(wallets[9], ForwarderJson) as MinimalForwarder

    })

    // stakeweight or testallocpolicy params must be set
    type BaseBountyConfig = {
        minStake?: string,
        maxBrokers?: string,
        leavePol?: string,
        testJoinPol?: string,
    }
    type BountyConfig1 = BaseBountyConfig & {
        stakeWeight: string
    }
    type BountyConfig2 = BaseBountyConfig & {
        testAllocPolicy: string
    }

    const createBounty = async (config: BountyConfig1 | BountyConfig2): Promise<Bounty> => {
        const joinPolicies = []
        const joinPolicyParams = []
        if (config.minStake) {
            joinPolicies.push(minStakeJoinPolicy.address)
            joinPolicyParams.push(config.minStake)
        }
        if (config.maxBrokers) {
            joinPolicies.push(maxBrokersJoinPolicy.address)
            joinPolicyParams.push(config.maxBrokers)
        }
        if (config.testJoinPol) {
            joinPolicies.push(testJoinPolicy.address)
            joinPolicyParams.push(config.testJoinPol)
        }
        const leavePolicyParam = config.leavePol ? config.leavePol : "0"
        const allocationPolicyAddr: string = (<BountyConfig2>config).testAllocPolicy ? testAllocationPolicy.address : allocationPolicy.address
        let allocPolicyParam = ""
        if ((<BountyConfig1>config).stakeWeight !== undefined) {
            allocPolicyParam = (<BountyConfig1>config).stakeWeight
        } else {
            allocPolicyParam = (<BountyConfig2>config).testAllocPolicy
        }
        // console.log("deploying bounty with params: ", joinPolicies, joinPolicyParams, allocationPolicyAddr, allocPolicyParam)
        const bountyDeployTx = await bountyFactory.deployBountyAgreement(0, 0, "Bounty-" + bountyCounter++, joinPolicies,
            joinPolicyParams, allocationPolicyAddr, allocPolicyParam, leavePolicy.address, leavePolicyParam)
        const bountyDeployReceipt = await bountyDeployTx.wait()
        const newBountyAddress = bountyDeployReceipt.events?.filter((e) => e.event === "NewBounty")[0]?.args?.bountyContract
        expect(newBountyAddress).to.be.not.undefined
        // console.log("bounty " + newBountyAddress)

        const agreementFactory = await ethers.getContractFactory("Bounty")
        bountyFromAdmin = new Contract(newBountyAddress, agreementFactory.interface, adminWallet) as Bounty
        bountyFromBroker = new Contract(newBountyAddress, agreementFactory.interface, brokerWallet) as Bounty
        return bountyFromAdmin
    }

    it.only("positivetest deploy bounty through factory, join bounty", async function(): Promise<void> {
        await createBounty({ minStake: "2000000000000000000", maxBrokers: "1", stakeWeight: "1" })
        const tx = await datav2.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address)
        await tx.wait()
        expect (await bountyFromAdmin.getMyStake()).to.be.eq(ethers.utils.parseEther("2"))
    })

    it.only('permit on token without metaTx', async (): Promise<void> => {
        const nonce = 0
        const data = buildData(chainId, datav2.address, owner, spender, ethers.utils.parseEther("1"), nonce, ethers.constants.MaxUint256)
        const ownerPrivKeyBuffer = Buffer.from(owner.privateKey, "hex")
        const signature = signTypedMessage(ownerPrivKeyBuffer, { data })
        const { v, r, s } = fromRpcSig(signature)

        const receipt = await datav2.permit(owner.address, spender.address, ethers.utils.parseEther("1"), ethers.constants.MaxUint256, v, r, s)

        expect(await datav2.nonces(owner.address)).to.equal('1')
        expect(await datav2.allowance(owner.address, spender.address)).to.equal('1')
    })

    it('stake with permit without metatx', async (): Promise<void> => {
        // await createBounty({ minStake: "2000000000000000000", maxBrokers: "1", stakeWeight: "1" })
        // const tx = await datav2.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address)
        // await tx.wait()
        // expect (await bountyFromAdmin.getMyStake()).to.be.eq(ethers.utils.parseEther("2"))
    })

    it('stake with permit through metatx', async (): Promise<void> => {
        // admin is creating and signing transaction, wallet 9 is posting it and paying for gas
        await createBounty({ minStake: "0", maxBrokers: "1", stakeWeight: "1" })
        // const tx = await token.transferAndCall(bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address)
        // await tx.wait()
        // const adminWallet = wallets[8]

        // const data = await datav2.interface.encodeFunctionData("transferAndCall", 
        //     [bountyFromAdmin.address, ethers.utils.parseEther("2"), adminWallet.address])
        
        //everything for permit
        const dataForPermit = buildData(this.chainId, this.token.address)
        const brokerWalletKeyBuffer = Buffer.from(brokerWallet.privateKey, "hex")
        const signatureForPermit = signTypedMessage(brokerWalletKeyBuffer, { data: dataForPermit })

        const data = await bountyFromBroker.interface.encodeFunctionData("stakeWithPermit", 
            [brokerWallet.address, ethers.utils.parseEther("2")])
        const req = {
            from: adminWallet.address,
            to: datav2.address,
            value: '0',
            gas: '1000000',
            nonce: (await minimalForwarder.getNonce(adminWallet.address)).toString(),
            data
        }
        const d: TypedMessage<any> = {
            types,
            domain: {
                name: 'MinimalForwarder',
                version: '0.0.1',
                chainId: (await provider.getNetwork()).chainId,
                verifyingContract: minimalForwarder.address,
            },
            primaryType: 'ForwardRequest',
            message: req,
        }
        const options = {
            data: d,
            privateKey: utils.arrayify(adminWallet.privateKey) as Buffer,
            version: SignTypedDataVersion.V4,
        }
        const sign = signTypedData(options) // user0

        const res = await minimalForwarder.verify(req, sign)
        await expect(res).to.be.true
        const tx = await minimalForwarder.execute(req, sign)
        const receipt = await tx.wait()
        const dataAdminAfter = (await datav2.balanceOf(adminWallet.address)).toString()
        const dataBrokerAfter = (await datav2.balanceOf(brokerWallet.address)).toString()
        expect(await bountyFromAdmin.getMyStake()).to.equal(2)
    })
})

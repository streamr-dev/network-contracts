import { upgrades, ethers } from 'hardhat'
import { expect } from 'chai'

import type { MinimalForwarder } from '../typechain/MinimalForwarder'
import type { StreamStorageRegistryV2, StreamRegistry, NodeRegistry } from '../typechain'
import { signTypedData, SignTypedDataVersion, TypedMessage } from '@metamask/eth-sig-util'

// set timeout to 10 minutes
const types = {
    EIP712Domain: [
        {
            name: 'name', type: 'string'
        },
        {
            name: 'version', type: 'string'
        },
        {
            name: 'chainId', type: 'uint256'
        },
        {
            name: 'verifyingContract', type: 'address'
        },
    ],
    ForwardRequest: [
        {
            name: 'from', type: 'address'
        },
        {
            name: 'to', type: 'address'
        },
        {
            name: 'value', type: 'uint256'
        },
        {
            name: 'gas', type: 'uint256'
        },
        {
            name: 'nonce', type: 'uint256'
        },
        {
            name: 'data', type: 'bytes'
        },
    ],
}

describe('StreamStorageRegistry', async () => {
    let streamReg: StreamRegistry
    let nodeReg: NodeRegistry
    let reg: StreamStorageRegistryV2

    let forwarder: MinimalForwarder
    let forwarderFromMetatxSender: MinimalForwarder

    const wallets = await ethers.getSigners()
    const [admin, trusted, node0, node1, node2] = wallets

    const nodes = [node0, node1, node2]
    const nodeAddresses = nodes.map((w) => w.address)
    const nodeUrls = nodes.map((w, i) => `http://node${i}.url`)

    const testStreamId = admin.address.toLowerCase() + '/test'

    const metaTxSender = wallets[5]

    before(async () => {
        // set up nodes
        const nodeRegDeploy = await ethers.getContractFactory('NodeRegistry')
        const nodeRegDeployTx = await upgrades.deployProxy(nodeRegDeploy, [admin.address,
            false, nodeAddresses, nodeUrls], {
            kind: 'uups'
        })
        nodeReg = await nodeRegDeployTx.deployed() as NodeRegistry

        // set up streams
        const minimalForwarderFromUser0Factory = await ethers.getContractFactory('MinimalForwarder', wallets[9])
        forwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
        forwarderFromMetatxSender = forwarder.connect(metaTxSender)
        const streamRegistryFactory = await ethers.getContractFactory('StreamRegistryV4')
        const streamRegistryFactoryTx = await upgrades.deployProxy(streamRegistryFactory,
            ['0x0000000000000000000000000000000000000000', forwarder.address], {
                kind: 'uups'
            })
        streamReg = await streamRegistryFactoryTx.deployed() as StreamRegistry
        await streamReg.createStream('/test', 'test-metadata')
        await streamReg.grantRole(await streamReg.TRUSTED_ROLE(), trusted.address)

        // deploy StreamStorageRegistry
        const strDeploy = await ethers.getContractFactory('StreamStorageRegistry')
        const strDeployTx = await upgrades.deployProxy(strDeploy, [streamReg.address, nodeReg.address, forwarder.address], {
            kind: 'uups'
        })
        await strDeployTx.deployed()

        // upgrade to StreamStorageRegistryV2
        // upgrader needs to be trusted as well
        await streamReg.grantRole(await streamReg.TRUSTED_ROLE(), admin.address)
        const strV2Deploy = await ethers.getContractFactory('StreamStorageRegistryV2')
        const strV2DeployTx = await upgrades.upgradeProxy(strDeployTx.address, strV2Deploy, {
            kind: 'uups'
        })
        reg = await strV2DeployTx.deployed() as StreamStorageRegistryV2
        await streamReg.revokeRole(await streamReg.TRUSTED_ROLE(), admin.address)
    })

    it('can add nodes to a stream', async () => {
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        await expect(reg.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        // re-adding emits same events (dateCreated not updated, TODO: test/assert?)
        await expect(reg.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await reg.removeStorageNode(testStreamId, node1.address)
    })

    it('can remove nodes from a stream', async () => {
        await reg.addStorageNode(testStreamId, node0.address)

        expect(await reg.isStorageNodeOf(testStreamId, node0.address)).to.be.true
        await expect(reg.removeStorageNode(testStreamId, node0.address))
            .to.emit(reg, 'Removed').withArgs(testStreamId, node0.address)
        expect(await reg.isStorageNodeOf(testStreamId, node0.address)).to.be.false
    })

    it('can add and remove nodes from a stream', async () => {
        await reg.addStorageNode(testStreamId, node0.address)
        await expect(reg.addAndRemoveStorageNodes(testStreamId, [nodes[3].address, nodes[4].address], [nodes[0].address, nodes[1].address]))
            .to.emit(reg, 'Added').withArgs(testStreamId, nodes[3].address)
            .and.emit(reg, 'Added').withArgs(testStreamId, nodes[4].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[0].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[1].address)
        expect(await reg.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.true
        expect(await reg.isStorageNodeOf(testStreamId, nodes[4].address)).to.be.true
        expect(await reg.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.false
        expect(await reg.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.false
    })

    it('gives errors for non-existent streams and nodes', async () => {
        await expect(reg.addStorageNode(testStreamId, admin.address))
            .to.be.revertedWith('error_storageNodeNotRegistered')
        await expect(reg.addStorageNode('foo-bar', node0.address))
            .to.be.revertedWith('error_streamDoesNotExist')

        await expect(reg.addAndRemoveStorageNodes(testStreamId, [admin.address], []))
            .to.be.revertedWith('error_storageNodeNotRegistered')
        await expect(reg.addAndRemoveStorageNodes('foo-bar', [], []))
            .to.be.revertedWith('error_streamDoesNotExist')
    })

    it('will only modify nodes on sender\'s own streams', async () => {
        const testStreamId2 = node0.address.toLowerCase() + '/test3'
        await streamReg.connect(node0).createStream('/test3', 'test3-metadata')
        await expect(reg.addStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith('error_noEditPermission')
        await expect(reg.removeStorageNode(testStreamId2, node0.address))
            .to.be.revertedWith('error_noEditPermission')
        await expect(reg.addAndRemoveStorageNodes(testStreamId2, [], []))
            .to.be.revertedWith('error_noEditPermission')
    })

    it('removed nodes and streams aren\'t returned by isStorageNodeOf', async () => {
        const testStreamId2 = admin.address.toLowerCase() + '/test2'
        await streamReg.createStream('/test2', 'test2-metadata')

        await reg.addStorageNode(testStreamId2, node0.address)
        await reg.addStorageNode(testStreamId, node2.address)

        expect(await reg.isStorageNodeOf(testStreamId2, node0.address)).to.be.true
        await streamReg.deleteStream(testStreamId2)
        expect(await reg.isStorageNodeOf(testStreamId2, node0.address)).to.be.false

        expect(await reg.isStorageNodeOf(testStreamId, node2.address)).to.be.true
        await nodeReg.removeNode(node2.address)
        expect(await reg.isStorageNodeOf(testStreamId, node2.address)).to.be.false
    })

    it('allows TRUSTED_ROLE address to add and remove nodes', async () => {
        const r = reg.connect(trusted)
        await expect(r.addStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Added').withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.true

        await expect(r.removeStorageNode(testStreamId, node1.address))
            .to.emit(reg, 'Removed').withArgs(testStreamId, node1.address)
        expect(await r.isStorageNodeOf(testStreamId, node1.address)).to.be.false

        await expect(r.addAndRemoveStorageNodes(testStreamId, [nodes[0].address, nodes[1].address], [nodes[2].address, nodes[3].address]))
            .to.emit(reg, 'Added').withArgs(testStreamId, nodes[0].address)
            .and.emit(reg, 'Added').withArgs(testStreamId, nodes[1].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[2].address)
            .and.emit(reg, 'Removed').withArgs(testStreamId, nodes[3].address)
        expect(await r.isStorageNodeOf(testStreamId, nodes[0].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[1].address)).to.be.true
        expect(await r.isStorageNodeOf(testStreamId, nodes[2].address)).to.be.false
        expect(await r.isStorageNodeOf(testStreamId, nodes[3].address)).to.be.false
    })

    async function prepareMetatx(forwarder: MinimalForwarder, signKey: string, gas?: string) {
        // admin is creating and signing transaction, user0 is posting it and paying for gas
        const data = await reg.interface.encodeFunctionData('addStorageNode', [testStreamId, node1.address])
        const req = {
            from: admin.address,
            to: reg.address,
            value: '0',
            gas: gas ? gas : '1000000',
            nonce: (await forwarder.getNonce(admin.address)).toString(),
            data
        }
        const d: TypedMessage<any> = {
            types,
            domain: {
                name: 'MinimalForwarder',
                version: '0.0.1',
                chainId: (await ethers.provider.getNetwork()).chainId,
                verifyingContract: forwarder.address,
            },
            primaryType: 'ForwardRequest',
            message: req,
        }
        const options = {
            data: d,
            privateKey: ethers.utils.arrayify(signKey) as Buffer,
            version: SignTypedDataVersion.V4,
        }
        const sign = signTypedData(options) // user0
        return {req, sign}
    }

    it('positivetest metatransaction', async (): Promise<void> => {
        // admin is creating and signing transaction, sender is posting it and paying for gas
        await reg.removeStorageNode(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        
        const {req, sign} = await prepareMetatx(forwarderFromMetatxSender, admin.privateKey)
        const res = await forwarderFromMetatxSender.verify(req, sign)
        await expect(res).to.be .true
        const tx = await forwarderFromMetatxSender.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(1)

        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true
    })

    it('negativetest metatransaction, wrong forwarder', async (): Promise<void> => {
        await reg.removeStorageNode(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        // deploy second minimal forwarder
        const minimalForwarderFromUser0Factory = await ethers.getContractFactory('MinimalForwarder', wallets[9])
        const wrongFrowarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
        await wrongFrowarder.deployed()
        // check that forwarder is set
        expect(await reg.isTrustedForwarder(forwarderFromMetatxSender.address)).to.be.true
        expect(await reg.isTrustedForwarder(wrongFrowarder.address)).to.be.false
        // check that metatx works with new forwarder
        const {req, sign} = await prepareMetatx(wrongFrowarder, admin.privateKey)
        const res = await wrongFrowarder.verify(req, sign)
        await expect(res).to.be.true
        const tx = await wrongFrowarder.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(0)
        //internal call will have failed
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false

    })

    it('negativetest metatransaction, wrong signature', async (): Promise<void> => {
        const wrongKey = wallets[2].privateKey //wallets[0].privateKey (admin) would be correct
        const {req, sign} = await prepareMetatx(forwarderFromMetatxSender, wrongKey)
        const res = await forwarderFromMetatxSender.verify(req, sign)
        await expect(res).to.be.false
        await expect(forwarderFromMetatxSender.execute(req, sign))
            .to.be.revertedWith('MinimalForwarder: signature does not match request')
    })

    it('negativetest metatransaction not enough gas in internal transaction call', async (): Promise<void> => {
        await reg.removeStorageNode(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        const {req, sign} = await prepareMetatx(forwarderFromMetatxSender, admin.privateKey, '1000')
        const res = await forwarderFromMetatxSender.verify(req, sign)
        await expect(res).to.be.true
        const tx = await forwarderFromMetatxSender.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(0)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
    })

    it('positivetest reset trusted forwarder, then test metatx', async (): Promise<void> => {
        await reg.removeStorageNode(testStreamId, node1.address)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.false
        // deploy second minimal forwarder
        const minimalForwarderFromUser0Factory = await ethers.getContractFactory('MinimalForwarder', wallets[9])
        const newForwarder = await minimalForwarderFromUser0Factory.deploy() as MinimalForwarder
        await newForwarder.deployed()
        // set forwarder
        await streamReg.grantRole(await streamReg.TRUSTED_ROLE(), admin.address)
        await reg.setTrustedForwarder(newForwarder.address)
        await streamReg.revokeRole(await streamReg.TRUSTED_ROLE(), admin.address)
        // check that forwarder is set
        expect(await reg.isTrustedForwarder(forwarderFromMetatxSender.address)).to.be.false
        expect(await reg.isTrustedForwarder(newForwarder.address)).to.be.true
        // check that metatx works with new forwarder
        const {req, sign} = await prepareMetatx(newForwarder, admin.privateKey)
        const res = await newForwarder.verify(req, sign)
        await expect(res).to.be.true
        const tx = await newForwarder.execute(req, sign)
        const tx2 = await tx.wait()
        expect(tx2.logs.length).to.equal(1)
        expect(await reg.isStorageNodeOf(testStreamId, node1.address)).to.be.true
    })

    it('negativetest reset trusted forwarder, caller not trusted', async (): Promise<void> => {
        await expect(reg.setTrustedForwarder(ethers.Wallet.createRandom().address))
            .to.be.revertedWith('error_notTrustedRole')
    })
})

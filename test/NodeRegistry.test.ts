import { expect, use } from 'chai'
import { deployContract, MockProvider, solidity } from 'ethereum-waffle'
import { Contract, Wallet, utils } from 'ethers'

import NodeRegistry from '../build/NodeRegistry.json'
import ERC20Mintable from '../build/ERC20Mintable.json'
import TokenBalanceWeightStrategy from '../build/TokenBalanceWeightStrategy.json'
import WeightedNodeRegistry from '../build/WeightedNodeRegistry.json'

use(solidity)

const nodeCount = 3

describe('NodeRegistry', (): void => {
    const accounts: Wallet[] = new MockProvider().getWallets()
    const creatorAddress = accounts[0].address
    const nodeMetadatas: string[] = []
    const nodeAddresses: string[] = []
    const nodeRegAsSigners: Contract[] = []
    let nodeRegAsCreator: Contract
    let testToken: Contract
    let tokenStrat: Contract
    let weightedReg: Contract

    for (let i = 0; i < nodeCount; i++) {
        nodeMetadatas[i] = `http://node.url${i}`
        nodeAddresses[i] = accounts[i + 1].address
    }

    before(async () => {
        // pass half the trackers in constructor, and set the others
        const initialNodes = []
        const initialMetadata = []

        for (let i = 0; i < nodeCount / 2; i++) {
            initialMetadata.push(nodeMetadatas[i])
            initialNodes.push(nodeAddresses[i])
        }

        nodeRegAsCreator = await deployContract(accounts[0], NodeRegistry,
            [creatorAddress, false, initialNodes, initialMetadata])
        for (let i = 0; i < nodeCount; i++) {
            nodeRegAsSigners[i] = nodeRegAsCreator.connect(accounts[i + 1])
        }

        for (let i = 0; i < nodeCount; i++) {
            await expect(nodeRegAsSigners[i].createOrUpdateNodeSelf(nodeMetadatas[i]))
                .to.emit(nodeRegAsCreator, 'NodeUpdated')
        }

        testToken = await deployContract(accounts[0], ERC20Mintable, ['name', 'symbol'])
        await testToken.mint(nodeAddresses[0], utils.parseUnits('10', 'ether'), {
            from: creatorAddress
        })
        await testToken.mint(nodeAddresses[1], utils.parseUnits('100', 'ether'), {
            from: creatorAddress
        })
        tokenStrat = await deployContract(accounts[0], TokenBalanceWeightStrategy, [testToken.address])
        weightedReg = await deployContract(accounts[0], WeightedNodeRegistry,
            [creatorAddress, false, tokenStrat.address, initialNodes, initialMetadata])
    })

    describe('NodeRegistry', () => {
        it('node count and linked list functionality', async () => {
            const ncount = await nodeRegAsCreator.nodeCount()
            const ncountnumber = ncount.toNumber()

            expect(nodeCount).to.equal(ncountnumber)

            const allNodes = await nodeRegAsCreator.getNodes()
            for (let i = 0; i < nodeCount; i++) {
                const node = await nodeRegAsCreator.getNodeByNumber(i)
                expect(node[0]).to.equal(nodeAddresses[i])
            }

            for (let i = 0; i < nodeCount; i++) {
                const node = allNodes[i]
                expect(node[0]).to.equal(nodeAddresses[i])
            }
        })

        it('can remove node', async () => {
            // test removal from middle of list
            const mid = Math.floor(nodeCount / 2)
            await expect(nodeRegAsSigners[mid].removeNodeSelf()).to.emit(nodeRegAsCreator, 'NodeRemoved')
            await expect(nodeRegAsSigners[mid].removeNodeSelf()).to.be.reverted

            let ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount - 1).to.equal(ncount)
            let j = 0
            for (let i = 0; i < nodeCount - 1; i++) {
                // check that every node except mid is listed
                const nodeadd = (await nodeRegAsCreator.getNodeByNumber(i))[0]
                if (j === mid) { j++ }
                expect(nodeadd).to.equal(nodeAddresses[j++])
            }
            // re-add middle node
            await expect(nodeRegAsSigners[mid].createOrUpdateNodeSelf(nodeMetadatas[mid]))
                .to.emit(nodeRegAsCreator, 'NodeUpdated')

            ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
        })

        it('only admin can remove/modify another node', async () => {
            // test removal from middle of list
            const mid = Math.floor(nodeCount / 2)

            await expect(nodeRegAsSigners[mid].removeNode(nodeAddresses[mid])).to.be.reverted
            await expect(nodeRegAsCreator.removeNode(nodeAddresses[mid])).to.emit(nodeRegAsCreator, 'NodeRemoved')

            let ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount - 1).to.equal(ncount)
            let j = 0
            for (let i = 0; i < nodeCount - 1; i++) {
                // check that every node except mid is listed
                const nodeadd = (await nodeRegAsCreator.getNodeByNumber(i))[0]
                if (j === mid) { j++ }
                expect(nodeadd).to.equal(nodeAddresses[j++])
            }
            // re-add middle node
            await expect(nodeRegAsSigners[mid].createOrUpdateNode(nodeAddresses[mid], nodeMetadatas[mid]))
                .to.be.reverted
            await expect(nodeRegAsCreator.createOrUpdateNode(nodeAddresses[mid], nodeMetadatas[mid]))
                .to.emit(nodeRegAsCreator, 'NodeUpdated')
            ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
        })

        it('can update node', async () => {
            const newurl = 'http://another.url'
            await expect(nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.emit(nodeRegAsCreator, 'NodeUpdated')

            const ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
            const nodeinfo = await nodeRegAsCreator.getNode(nodeAddresses[0])
            expect(nodeinfo[1]).to.equal(newurl)
        })

        it('whitelist works', async () => {
            const newurl = 'http://another.url2'
            await expect(nodeRegAsSigners[0].setRequiresWhitelist(true)).to.be.reverted
            await nodeRegAsCreator.setRequiresWhitelist(true)
            await expect(nodeRegAsCreator.kickOut(nodeAddresses[0])).to.emit(nodeRegAsCreator, 'NodeWhitelistRejected')
            await expect(nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.be.reverted
            await expect(nodeRegAsSigners[0].whitelistApproveNode(nodeAddresses[0])).to.be.reverted
            await nodeRegAsCreator.whitelistApproveNode(nodeAddresses[0])
            await expect(nodeRegAsSigners[0].createOrUpdateNodeSelf(newurl)).to.emit(nodeRegAsCreator, 'NodeUpdated')
            const ncount = (await nodeRegAsCreator.nodeCount()).toNumber()
            expect(nodeCount).to.equal(ncount)
            const nodeinfo = await nodeRegAsCreator.getNode(nodeAddresses[0])
            expect(nodeinfo[1]).to.equal(newurl)
        })
    })

    describe('WeightedNodeRegistry', () => {
        it('getWeight() works', async () => {
            for (let i = 0; i < nodeCount; i++) {
                const tokbal = await testToken.balanceOf(nodeAddresses[i])
                const weight = await weightedReg.getWeight(nodeAddresses[i])
                expect(tokbal).to.equal(weight)
            }
        })
    })
})

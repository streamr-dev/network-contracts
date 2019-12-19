const Web3 = require("web3")
const { assertEqual, assertFails, assertEvent } = require("./utils/web3Assert")

const w3 = new Web3(web3.currentProvider)
const SimpleTrackerRegistry = artifacts.require("./SimpleTrackerRegistry.sol")
const TokenBalanceWeightStrategy = artifacts.require("./TokenBalanceWeightStrategy.sol")
const WeightedNodeRegistry = artifacts.require("./WeightedNodeRegistry.sol")
const ERC20Mintable = artifacts.require("openzeppelin-solidity/contracts/token/ERC20/ERC20Mintable.sol")
const nodeCount = 3

contract("NodeRegistry", accounts => {
    const creator = accounts[0]
    let nodes = []
    let node_addresses = []
    let testToken
    let stReg
    let tokenStrat
    let weightedReg
    for(var i=0; i < nodeCount; i++){
        nodes[i]= `http://node.url${i}`
        node_addresses[i] = accounts[i+1]
    }
    const day = 86400
    //console.log(`creator: ${creator}`)
    before(async () => {
        //console.log(JSON.stringify(SimpleTrackerRegistry))
        stReg = await SimpleTrackerRegistry.new(creator, true, { from: creator })
        for(var i=0; i < nodeCount; i++){
            assertEvent(await stReg.createOrUpdateNode(nodes[i],{from: node_addresses[i]}), "NodeUpdated")
        }

        testToken = await ERC20Mintable.new({ from: creator })
        await testToken.mint(node_addresses[0], w3.utils.toWei("10"), { from: creator })
        await testToken.mint(node_addresses[1], w3.utils.toWei("100"), { from: creator })
        tokenStrat = await TokenBalanceWeightStrategy.new(testToken.address, { from: creator })
        weightedReg = await WeightedNodeRegistry.new(creator, true, tokenStrat.address, { from: creator })
    }),
    describe("SimpleTrackerRegistry", () => {
        it("node count and linked list functionality", async () => {
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            //var nodeIds = new Map()
            for(var i=0; i < nodeCount; i++){
                var nodeadd = await stReg.getNodeByNumber(i)
                assertEqual(nodeadd, node_addresses[i])
            }
        }),
        it("can remove node", async () => {
            //test removal from middle of list
            var mid = Math.floor(nodeCount/2)
            assertEvent(await stReg.removeNode({from: node_addresses[mid]}), "NodeRemoved")
            await assertFails(stReg.removeNode({from: node_addresses[mid]}))       
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount -1, ncount)
            var j=0
            for(var i=0; i < nodeCount - 1; i++){
                // check that every node except mid is listed
                var nodeadd = await stReg.getNodeByNumber(i)
                if(j == mid)
                    j++
                assertEqual(nodeadd, node_addresses[j++])
            }
            //re-add middle node
            assertEvent(await stReg.createOrUpdateNode(nodes[mid],{from: node_addresses[mid]}), "NodeUpdated")
            ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
        }),
        it("getTrackers retuns a valid node and spans all nodes", async () => {

            var nodeNums = new Set();
            for(var i=0; i< nodeCount * 5; i++){
                const url = await stReg.getTrackers(`stereamId${i}`,i)
                //console.log(`url ${url}`)
                const index = nodes.indexOf(url)
                assert(index >= 0)
                nodeNums.add(index)
            }
            assertEqual(nodeNums.size, nodeCount)
        }),
        it("can update node", async () => {
            const newurl = "http://another.url"
            assertEvent(await stReg.createOrUpdateNode(newurl,  {from: node_addresses[0]}), "NodeUpdated")
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            var nodeinfo = await stReg.getNode(node_addresses[0])
            assertEqual(nodeinfo[0], newurl)
        }),
        it("whitelist works", async () => {
            const newurl = "http://another.url2"
            await assertFails(stReg.setPermissionless(false, {from: node_addresses[0]}))
            await stReg.setPermissionless(false, {from: creator})
            await assertFails(stReg.createOrUpdateNode(newurl,  {from: node_addresses[0]}))
            await assertFails(stReg.whitelistNode(node_addresses[0],  {from: node_addresses[0]}))
            await stReg.whitelistNode(node_addresses[0],  {from: creator})
            assertEvent(await stReg.createOrUpdateNode(newurl,  {from: node_addresses[0]}), "NodeUpdated")
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            var nodeinfo = await stReg.getNode(node_addresses[0])
            assertEqual(nodeinfo[0], newurl)
        })
    }),
    describe("WeightedNodeRegistry", () => {
        it("getWeight() works", async () => {
            for(var i=0; i < nodeCount; i++){
                let tokbal = await testToken.balanceOf(node_addresses[i])
                let weight = await weightedReg.getWeight(node_addresses[i])
                assertEqual(tokbal, weight)
            }  
        })
    })
})
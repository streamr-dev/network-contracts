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
        stReg = await SimpleTrackerRegistry.new(creator, false, { from: creator })
        for(var i=0; i < nodeCount; i++){
            assertEvent(await stReg.createOrUpdateNodeSelf(nodes[i],{from: node_addresses[i]}), "NodeUpdated")
        }

        testToken = await ERC20Mintable.new({ from: creator })
        await testToken.mint(node_addresses[0], w3.utils.toWei("10"), { from: creator })
        await testToken.mint(node_addresses[1], w3.utils.toWei("100"), { from: creator })
        tokenStrat = await TokenBalanceWeightStrategy.new(testToken.address, { from: creator })
        weightedReg = await WeightedNodeRegistry.new(creator, false, tokenStrat.address, { from: creator })
    }),
    describe("SimpleTrackerRegistry", () => {
        it("node count and linked list functionality", async () => {
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            const allNodes = await stReg.getNodes();
//            console.log(`allnodes: ${JSON.stringify(allNodes)}`)
            for(var i=0; i < nodeCount; i++){
                var node = await stReg.getNodeByNumber(i)
                assertEqual(node[0], node_addresses[i])
            }
            
            for(i=0; i < nodeCount; i++){
                var node = allNodes[i]
                assertEqual(node[0], node_addresses[i])
            }
        }),
        it("can remove node", async () => {
            //test removal from middle of list
            var mid = Math.floor(nodeCount/2)
            assertEvent(await stReg.removeNodeSelf({from: node_addresses[mid]}), "NodeRemoved")
            await assertFails(stReg.removeNodeSelf({from: node_addresses[mid]}))       
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount -1, ncount)
            var j=0
            for(var i=0; i < nodeCount - 1; i++){
                // check that every node except mid is listed
                var nodeadd = (await stReg.getNodeByNumber(i))[0]
                if(j == mid)
                    j++
                assertEqual(nodeadd, node_addresses[j++])
            }
            //re-add middle node
            assertEvent(await stReg.createOrUpdateNodeSelf(nodes[mid],{from: node_addresses[mid]}), "NodeUpdated")
            ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
        }),
        
        it("only admin can remove/modify another node", async () => {
            //test removal from middle of list
            var mid = Math.floor(nodeCount/2)
            await assertFails(stReg.removeNode(node_addresses[mid], {from: node_addresses[mid]}))       
            assertEvent(await stReg.removeNode(node_addresses[mid], {from: creator}), "NodeRemoved")
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount -1, ncount)
            var j=0
            for(var i=0; i < nodeCount - 1; i++){
                // check that every node except mid is listed
                var nodeadd = (await stReg.getNodeByNumber(i))[0]
                if(j == mid)
                    j++
                assertEqual(nodeadd, node_addresses[j++])
            }
            //re-add middle node
            //console.log(`mid_address: ${node_addresses[mid]}`)
            await assertFails(stReg.createOrUpdateNode(node_addresses[mid], nodes[mid], {from: node_addresses[mid]}))
            assertEvent(await stReg.createOrUpdateNode(node_addresses[mid], nodes[mid], {from: creator}), "NodeUpdated")
            //const allNodes = await stReg.getNodes();
            //console.log(`allnodes: ${JSON.stringify(allNodes)}`)
            ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
        }),
        
        it("getTrackers retuns a valid node and spans all nodes", async () => {

            var nodeNums = new Set();
            for(var i=0; i< nodeCount * 5; i++){
                const urls = await stReg.getTrackers(`stereamId${i}`,i)
                //console.log(`url ${url}`)
                const index = nodes.indexOf(urls[0])
                assert(index >= 0)
                nodeNums.add(index)
            }
            assertEqual(nodeNums.size, nodeCount)
        }),
        it("can update node", async () => {
            const newurl = "http://another.url"
            assertEvent(await stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}), "NodeUpdated")
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            var nodeinfo = await stReg.getNode(node_addresses[0])
            assertEqual(nodeinfo[1], newurl)
        }),
        it("whitelist works", async () => {
            const newurl = "http://another.url2"
            await assertFails(stReg.setRequiresWhitelist(true, {from: node_addresses[0]}))
            await stReg.setRequiresWhitelist(true, {from: creator})
            assertEvent(await stReg.kickOut(node_addresses[0],  {from: creator}),"NodeWhitelistRejected")
            await assertFails(stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}))
            await assertFails(stReg.whitelistApproveNode(node_addresses[0],  {from: node_addresses[0]}))
            await stReg.whitelistApproveNode(node_addresses[0],  {from: creator})
            assertEvent(await stReg.createOrUpdateNodeSelf(newurl,  {from: node_addresses[0]}), "NodeUpdated")
            var ncount = await stReg.nodeCount()
            assertEqual(nodeCount, ncount)
            var nodeinfo = await stReg.getNode(node_addresses[0])
            assertEqual(nodeinfo[1], newurl)
            
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
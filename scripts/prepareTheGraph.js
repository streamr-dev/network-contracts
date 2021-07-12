var fs = require('fs')
let address
let abi

fs.readFile('./packages/smartcontracts/deployments/localsidechain/Streamregistry.json', 'utf8', function (err, data) {
  if (err) {
    return console.log(err);
  }
  const constractinfo = JSON.parse(data)
  address = constractinfo.address
  abi = constractinfo.abi
  
  fs.readFile('./packages/streamregistry-thegraph-subgraph/subgraph.yaml', 'utf8', function (err, data) {
      if (err) {
          return console.log(err);
        }
        const result = data.replace(/address: '.+'/, 'address: \'' + address + '\'');
        
        fs.writeFile('./packages/streamregistry-thegraph-subgraph/subgraph.yaml', result, 'utf8', function (err) {
            if (err) return console.log(err);
        });
    });
    
    fs.writeFile('./packages/streamregistry-thegraph-subgraph/abis/StreamRegistry.json', JSON.stringify(abi), 'utf8',  function (err) {
        if (err) return console.log(err);
    });
});
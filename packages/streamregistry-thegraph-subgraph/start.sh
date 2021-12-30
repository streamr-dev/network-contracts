result=$(curl --silent -X POST -H "Content-Type: application/json" -d '{"query":"{nodes{id}}"}' http://streamr-dev-thegraph-node:8000/subgraphs/name/streamr-dev/network-contracts) 
echo $result
if ! [ "$result" = '{"data":{"nodes":[{"id":"0xde1112f631486cfc759a50196853011528bc5fa0"}]}}' ]; then
    echo "Not deployed yet, trying to deploy subgraph"
    npm run doAll-inside-docker-dev
    set -e
    curl --write-out %{http_code} --silent --output /dev/null -X POST -H "Content-Type: application/json" -d '{"query":"{nodes{id}}"}' http://streamr-dev-thegraph-node:8000/subgraphs/name/streamr-dev/network-contracts
else
    echo "Subgraph already deployed, doing nothing"
    exit 0
fi
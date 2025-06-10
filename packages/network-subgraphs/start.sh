CONTAINER_ALREADY_STARTED="/firstrun/CONTAINER_ALREADY_STARTED_PLACEHOLDER"
GRAPH_NODE_URL="http://streamr-dev-thegraph-node-fastchain:8000"

wait_for_graph_node_start() {
    while true; do
        if curl --fail --silent --max-time 1 $GRAPH_NODE_URL; then
            echo "Graph Node is ready"
            break
        else
            echo "Waiting for Graph Node to start..."
        fi
        sleep 1s
    done
}

if [ ! -e $CONTAINER_ALREADY_STARTED ]; then
    touch $CONTAINER_ALREADY_STARTED
    echo "-- First container startup: wait for Graph Node to start, then deploying subgraph --"
    # TODO we could also wait for dev-chain-fast and postgres start, but in practice these are started almost immediately
    # and therefore it makes sense to wait only for the Graph Node
    wait_for_graph_node_start
    npx graph create streamr-dev/network-subgraphs --node http://streamr-dev-thegraph-node-fastchain:8020
    npx graph deploy streamr-dev/network-subgraphs --version-label v0.0.1 --ipfs http://streamr-dev-ipfs:5001 --node http://streamr-dev-thegraph-node-fastchain:8020
else
    echo "-- Not first container startup, doing nothing.--"
fi
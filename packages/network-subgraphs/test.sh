node create-subgraph-config-json.mjs > subgraph-config.json
 ./generate-yamls.sh
diff subgraph_amoy.yaml subgraph_amoy_generated.yaml
diff subgraph_dev2.yaml subgraph_dev2_generated.yaml
diff subgraph_iotex.yaml subgraph_iotext_generated.yaml
diff subgraph_peaq.yaml subgraph_peaq_generated.yaml
diff subgraph_polygon.yaml subgraph_polygon_generated.yaml

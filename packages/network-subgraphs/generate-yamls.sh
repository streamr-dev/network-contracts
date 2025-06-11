jq '.dev2' subgraph-config.json | node scripts/fill-handlebars-template.mjs subgraph.yaml.hbs > subgraph_dev2_generated.yaml
jq '.polygon' subgraph-config.json | node scripts/fill-handlebars-template.mjs subgraph.yaml.hbs > subgraph_polygon_generated.yaml
jq '.polygonAmoy' subgraph-config.json | node scripts/fill-handlebars-template.mjs subgraph.yaml.hbs > subgraph_amoy_generated.yaml
jq '.peaq' subgraph-config.json | node scripts/fill-handlebars-template.mjs subgraph.yaml.hbs > subgraph_peaq_generated.yaml
jq '.iotex' subgraph-config.json | node scripts/fill-handlebars-template.mjs subgraph.yaml.hbs > subgraph_iotext_generated.yaml


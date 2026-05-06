SELECT id, name, longitude, latitude, height 
FROM locations 
WHERE height = 10.0 OR longitude < 112.0 
LIMIT 5;

SELECT e.id, e.source_node, e.target_node
FROM edges e
LEFT JOIN locations l1 ON e.source_node = l1.id
LEFT JOIN locations l2 ON e.target_node = l2.id
WHERE l1.name IS NULL OR l2.name IS NULL;

SELECT * 
FROM view_bidirectional_paths 
WHERE source_node = 1 OR target_node = 1
ORDER BY source_node ASC;

SELECT id, road_name, flow_morning, flow_noon, flow_evening 
FROM edges 
WHERE flow_morning IS NULL OR flow_morning > 1.0;

SELECT 
    (SELECT COUNT(*) FROM locations) AS total_locations,
    (SELECT COUNT(*) FROM edges) AS total_edges,
    (SELECT COUNT(*) FROM view_bidirectional_paths) AS total_virtual_paths;
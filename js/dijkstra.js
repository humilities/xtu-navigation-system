/**
 * 初始化边的综合权重（距离×(1+人流系数)）
 * @param {Object} graph 拓扑数据
 * @param {String} timePeriod 时段（morning/noon/evening/weekend）
 * @returns {Object} 带权重的拓扑图
 */
function initEdgeWeights(graph, timePeriod) {
  const updatedGraph = JSON.parse(JSON.stringify(graph));
  updatedGraph.edges.forEach(edge => {
    const flowRate = edge.flow[timePeriod] || 0.2; // 默认人流系数0.2
    edge.weight = edge.distance * (1 + flowRate); // 综合权重公式
  });
  return updatedGraph;
}

/**
 * 优化版Dijkstra算法（适配人流+距离权重）
 * @param {Number} start 起点ID
 * @param {Number} end 终点ID
 * @param {Object} graph 带权重的拓扑图
 * @returns {Object} 路径结果（路径节点、总权重、总距离）
 */
function dijkstra(start, end, graph) {
  // 1. 初始化数据
  const dist = {}; // 起点到各节点的最小权重
  const prev = {}; // 前驱节点（记录路径）
  const unvisited = new Set(graph.nodes.map(node => node.id)); // 未访问节点
  const nodeMap = new Map(graph.nodes.map(node => [node.id, node])); // 节点ID映射

  // 2. 初始化距离表：起点到自己为0，其余为无穷大
  graph.nodes.forEach(node => {
    dist[node.id] = node.id === start ? 0 : Infinity;
    prev[node.id] = null;
  });

  // 3. 核心遍历
  while (unvisited.size > 0) {
    // 找到未访问节点中权重最小的节点
    let minNodeId = null;
    unvisited.forEach(id => {
      if (minNodeId === null || dist[id] < dist[minNodeId]) {
        minNodeId = id;
      }
    });
    if (minNodeId === null || dist[minNodeId] === Infinity) break; // 无可达路径
    unvisited.delete(minNodeId);

    // 到达终点，提前终止
    if (minNodeId === end) break;

    // 遍历当前节点的所有邻接边
    const adjacentEdges = graph.edges.filter(edge => edge.from === minNodeId);
    adjacentEdges.forEach(edge => {
      const neighborId = edge.to;
      if (!unvisited.has(neighborId)) return;
      const newDist = dist[minNodeId] + edge.weight;
      // 更新权重（更优则替换）
      if (newDist < dist[neighborId]) {
        dist[neighborId] = newDist;
        prev[neighborId] = minNodeId;
      }
    });
  }

  // 4. 回溯生成路径
  const path = [];
  let current = end;
  let totalDistance = 0; // 总实际距离（非权重）
  while (current !== null) {
    path.unshift(current);
    current = prev[current];
  }

  // 计算总实际距离
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    const edge = graph.edges.find(e => e.from === from && e.to === to);
    if (edge) totalDistance += edge.distance;
  }

  // 路径无效处理
  if (path[0] !== start) {
    return { path: [], totalWeight: Infinity, totalDistance: 0, pathNodes: [] };
  }

  // 转换为节点详情
  const pathNodes = path.map(id => nodeMap.get(id));

  return {
    path: path,
    totalWeight: dist[end],
    totalDistance: totalDistance,
    pathNodes: pathNodes
  };
}

// 暴露函数（供外部调用）
window.dijkstra = dijkstra;
window.initEdgeWeights = initEdgeWeights;
const createGraph = require('ngraph.graph');
const path = require('ngraph.path');

/**
 * 核心算法函数
 * @param {Array} edges - 从数据库 view_bidirectional_paths 查出的边数据
 * @param {Number} startNode - 起点 ID
 * @param {Number} endNode - 终点 ID
 */
function findShortestPath(edges, startNode, endNode) {
    const g = createGraph();

    // 1. 构建内存图
    edges.forEach(edge => {
        // 使用视图计算好的权重字段
        g.addLink(edge.source_node, edge.target_node, { weight: parseFloat(edge.weight) });
    });

    // 2. 初始化 A* 或 Dijkstra 算法
    // A* 通常比 Dijkstra 更快，适合有地理坐标的校园导航
    const pathFinder = path.aStar(g, {
        distance(fromNode, toNode, link) {
            return link.data.weight; // 返回动态拥挤度权重
        }
    });

    // 3. 计算路径
    const foundPath = pathFinder.find(startNode, endNode);
    
    // 4. 处理结果 (将节点列表反转，因为算法通常是从终点往回找)
    return {
        nodes: foundPath.map(node => parseInt(node.id)).reverse(),
        // 这里的 distance 实际上是经过权重加权后的“代价”
        cost: foundPath.reduce((acc, node, idx) => {
            if (idx === 0) return 0;
            const link = g.getLink(foundPath[idx-1].id, node.id);
            return acc + link.data.weight;
        }, 0)
    };
}

module.exports = { findShortestPath };
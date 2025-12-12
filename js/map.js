// 全局变量
let map = null;
let pathLayer = null; // 路线图层
let graph = null; // 拓扑数据

// 初始化地图
async function initMap() {
  // 1. 加载拓扑数据
  const res = await fetch('./json/xtu_graph.json');
  graph = await res.json();

  // 2. 初始化Leaflet地图（适配静态图片）
  map = L.map('map-container', {
    crs: L.CRS.Simple,
    minZoom: -2,
    maxZoom: 2,
    zoomControl: true
  });

  // 3. 加载校园背景图（800×600像素）
  const imgWidth = 1200;
  const imgHeight = 1460;
  const bounds = [[0, 0], [imgHeight, imgWidth]]; // Leaflet坐标：[y, x]
  L.imageOverlay('./assets/xtu-map.jpg', bounds).addTo(map);
  map.fitBounds(bounds);

  // 4. 标注所有景点
  graph.nodes.forEach(node => {
    const marker = L.marker([node.y, node.x])
      .addTo(map)
      .bindPopup(`<strong>${node.name}</strong><br>${node.desc}`);
    // 点击景点设为起点/终点（可选）
    marker.on('click', () => {
      const activeSelect = document.querySelector('.select-active');
      if (activeSelect) activeSelect.value = node.id;
    });
  });

  // 5. 绑定查询按钮事件
  document.getElementById('search-btn').addEventListener('click', searchPath);
  // 6. 绑定时段切换事件
  document.getElementById('time-period').addEventListener('change', () => {
    if (document.getElementById('start').value && document.getElementById('end').value) {
      searchPath();
    }
  });

  // 7. 初始化下拉框（起点/终点）
  initSelectOptions();
}

// 初始化起点/终点下拉框
function initSelectOptions() {
  const startSelect = document.getElementById('start');
  const endSelect = document.getElementById('end');
  graph.nodes.forEach(node => {
    const option = `<option value="${node.id}">${node.name}</option>`;
    startSelect.innerHTML += option;
    endSelect.innerHTML += option;
  });
}

// 查询最优路径
function searchPath() {
  const startId = Number(document.getElementById('start').value);
  const endId = Number(document.getElementById('end').value);
  const timePeriod = document.getElementById('time-period').value;

  // 校验输入
  if (startId === endId) {
    alert('起点和终点不能相同！');
    return;
  }

  // 1. 初始化边权重（结合时段人流）
  const weightedGraph = initEdgeWeights(graph, timePeriod);
  // 2. 调用Dijkstra算法
  const result = dijkstra(startId, endId, weightedGraph);

  // 3. 处理结果
  if (result.path.length === 0) {
    alert('暂无可达路径！');
    return;
  }

  // 4. 绘制路线
  drawPath(result.pathNodes);
  // 5. 显示路径信息
  showPathInfo(result);
}

// 绘制路线
function drawPath(pathNodes) {
  // 清除原有路线
  if (pathLayer) map.removeLayer(pathLayer);
  // 提取坐标（Leaflet：[y, x]）
  const latlngs = pathNodes.map(node => [node.y, node.x]);
  // 绘制红色粗线
  pathLayer = L.polyline(latlngs, {
    color: '#ff0000',
    weight: 5,
    opacity: 0.8,
    dashArray: ''
  }).addTo(map);
  // 自动聚焦到路线
  map.fitBounds(pathLayer.getBounds(), { padding: [50, 50] });
}

// 显示路径详情
function showPathInfo(result) {
  const infoEl = document.getElementById('path-info');
  const pathNames = result.pathNodes.map(node => node.name).join(' → ');
  const walkTime = Math.ceil(result.totalDistance / 5000 * 60); // 步行时间（5km/h）
  infoEl.innerHTML = `
    <h4>最优路径</h4>
    <p>路线：${pathNames}</p>
    <p>总距离：${result.totalDistance} 米</p>
    <p>预计步行时间：${walkTime} 分钟</p>
    <p>综合权重：${result.totalWeight.toFixed(2)}</p>
  `;
}

// 页面加载完成后初始化
window.onload = initMap;
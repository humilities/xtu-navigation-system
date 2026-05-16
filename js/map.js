// 全局变量
let map = null;
let pathLayer = null; // 路线图层
let graph = null; // 拓扑数据
let imgHeight = 1460; // 图片高度（用于Y轴翻转）
let allMarkers = []; // 新增：保存所有标记用于筛选

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
  const imgWidth = 1020;
  imgHeight = 1460;
  const bounds = [[0, 0], [imgHeight, imgWidth]]; // Leaflet坐标：[y, x]
  L.imageOverlay('./assets/xtu-map.jpg', bounds).addTo(map);
  map.fitBounds(bounds);

  // 4. 标注所有景点（修复：绑定category并存入数组）
  graph.nodes.forEach(node => {
    const correctedY = imgHeight - node.y; // 翻转 Y 轴

    const marker = L.marker([correctedY, node.x], {
      title: node.name,
      desc: node.desc,
      img: "",
      flow: ["人流时段正常"],
      category: node.category // 绑定分类
    })
      .addTo(map)
      .bindPopup(`<strong>${node.name}</strong><br>${node.desc}`);

    // 存入数组，用于筛选
    allMarkers.push(marker);

    // 点击景点设为起点/终点
    marker.on('click', () => {
      const activeSelect = document.querySelector('.select-active');
      if (activeSelect) activeSelect.value = node.id;
    });
  });

  // 5. 绑定查询按钮事件
  document.getElementById('search-btn').addEventListener('click', searchPath);
  // 6. 绑定时段切换事件
  document.getElementById('time-period').addEventListener('change', () => {
    const startVal = document.getElementById('start').value;
    const endVal = document.getElementById('end').value;
    // 检查起点和终点是否已选择（非空字符串）
    if (startVal && endVal && startVal !== endVal) {
      searchPath();
    }
  });

  // 7. 初始化下拉框（起点/终点）
  initSelectOptions();

  // 8. 给所有地图标记绑定点击事件（移到这里，标记创建完成后执行）
  map.eachLayer(layer => {
    if (layer instanceof L.Marker && layer.options && layer.options.title) {
      layer.on('click', function() {
        // 填充面板信息
        panelTitle.innerText = this.options.title;
        panelDesc.innerText = this.options.desc || "暂无景点介绍";
        panelImg.src = this.options.img || "";
        
        panelFlow.innerHTML = "";
        let flowList = this.options.flow || ["人流正常"];
        flowList.forEach(item=>{
          let li = document.createElement("li");
          li.innerText = item;
          panelFlow.appendChild(li);
        });

        // 弹出侧边栏
        detailPanel.classList.add('active');
      });
    }
  });
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
  const latlngs = pathNodes.map(node => [imgHeight-node.y, node.x]);
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

// 搜索景点定位 + 侧边面板
const searchInput = document.getElementById('searchInput');
const searchBtn = document.getElementById('searchBtn');
const detailPanel = document.getElementById('detailPanel');
const closePanel = document.getElementById('closePanel');
const panelTitle = document.getElementById('panelTitle');
const panelImg = document.getElementById('panelImg');
const panelDesc = document.getElementById('panelDesc');
const panelFlow = document.getElementById('panelFlow');

// 关闭侧边栏
closePanel.onclick = function(){
    detailPanel.classList.remove('active');
};

// 搜索功能
searchBtn.onclick = function(){
    let key = searchInput.value.trim();
    if(!key){
        alert("请输入景点名称");
        return;
    }

    // 遍历所有地图标记，模糊匹配名称（只匹配Marker）
    let findMarker = null;
    map.eachLayer(layer => {
        if(layer instanceof L.Marker && layer.options && layer.options.title && layer.options.title.includes(key)){
            findMarker = layer;
        }
    });

    if(!findMarker){
        alert("未找到该景点");
        return;
    }

    // 地图飞到该景点
    map.setView(findMarker.getLatLng(), 16);

    // 填充侧边栏信息
    panelTitle.innerText = findMarker.options.title;
    panelDesc.innerText = findMarker.options.desc || "暂无景点介绍";
    panelImg.src = findMarker.options.img || "";
    
    panelFlow.innerHTML = "";
    let flowList = findMarker.options.flow || ["人流正常"];
    flowList.forEach(item=>{
        let li = document.createElement("li");
        li.innerText = item;
        panelFlow.appendChild(li);
    });

    // 弹出侧边栏
    detailPanel.classList.add('active');
};

// 回车也能搜索
searchInput.addEventListener('keydown',function(e){
    if(e.key === 'Enter') searchBtn.click();
});

// ========== 分类筛选器功能（修复版） ==========
function filterMarkers(category) {
  // 先把所有标记都恢复到地图上
  allMarkers.forEach(marker => {
    marker.addTo(map);
  });

  // 如果不是"全部"，再隐藏不匹配的分类
  if (category !== 'all') {
    allMarkers.forEach(marker => {
      if (marker.options.category !== category) {
        map.removeLayer(marker);
      }
    });
  }
}

// 绑定筛选按钮点击事件
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', function () {
    // 切换按钮选中样式
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
    let type = this.getAttribute('data-category');
    filterMarkers(type);
  });
});
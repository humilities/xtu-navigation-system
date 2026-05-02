# 数据库建表

---

## 建筑表

记录id, name, category, longitude, latitude, height。
这里longitude和latitude分别作为经纬度。
以id作为访问主键。

---

## 图片关联表

记录id，location_id,url,is_primary
以id作为访问主键

---

## 边表

记录source_node, target_node, distance, flow_morning, flow_noon, flow_evening。
同样已id作为访问主键。

---

## 失物招领表

属于关联性数据。
该表需要以location_id作为外键访问locations表。
记录id,location_id,type,item_name,description,contact,status,created_at。

---

## 建筑点评表

同样属于关联性数据。
同样需要以location_is作为外键访问locations表。
记录id,location_id,user_nickname,rating,comment,created_at。

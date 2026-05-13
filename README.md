# 在线考试系统（风险自适应）

学期里的一个课程作业，做完之后觉得思路还挺好玩、还能继续往下做，所以扔上来。

简单来说就是一个 Web 在线考试系统，特点是会在考试过程中根据考生的浏览器行为（切屏、复制粘贴、刷新等）累计风险分，分数高了就触发二次人脸核验，监考员也能手动干预。

不是商用级的"防作弊"，更接近于"我能不能用一套权重系统去衡量考试过程中的可疑程度"的练手项目。

## 技术栈

前端 React 19 + TypeScript + Vite 8，没有用任何 UI 库，样式都在 `App.css` 里自己写的。

后端 FastAPI + Uvicorn，单文件 `main.py`。人脸比对用 DeepFace，数据库就一个 SQLite 文件放在 `data/` 下。

## 三种角色

- **学生**：登录 → 选考试 → 考前人脸核验 → 答题 → 提交。答题过程中前端会监听切屏、失焦、复制粘贴、刷新、退出全屏、网络变化这些事件，每发生一次就上报后端记一笔风险事件。
- **监考员**：实时看所有考生的会话、风险分、最近一次核验快照，可以发通知、冻结/解冻某个考生。
- **管理员**：管账号、管考试、管题目，最关键的是可以调风控参数——每种行为的权重、警告阈值、高危阈值都能改。

## 风险分怎么算的

简单的加权累计 `main.py` 里有一份默认配置：

```
session_weights:   切屏 22 / 失焦 15 / 退出全屏 28 / 复制粘贴 26 / 刷新 30 / 重复异常 18
context_weights:   设备变化 28 / IP 变化 34 / 网络重连 18 / 摄像头中断 20
warning_threshold: 35
high_risk_threshold: 62
```
`ws` 和 `wf` 是会话行为和上下文行为两类事件的权重系数（默认 0.55 / 0.45）。最终风险分超过 `high_risk_threshold` 就会被前端弹出二次核验。

```bash
# 后端依赖
py -m pip install -r requirements.txt
# 前端依赖
npm install
```

Windows 下我写了个一键启动脚本：

```powershell
.\start-local.ps1
```

非 Windows 平台没写脚本，分别开两个终端：

```bash
py -m uvicorn main:app --reload --port 8000
npm run dev
```

## 演示账号

仓库里的 `data/exam_system.db` 是空库或者初始化库，第一次跑起来后端会自建表。默认管理员账号 `admin01`，密码在 `start-local.ps1` 里有显示。

> 这一版为了演示方便，密码是明文存的。如果要拿这个跑生产环境，至少要加 bcrypt。我知道这点不好，下一版会改。

## 目录大致结构

```
src/
  App.tsx              全局状态 + 路由调度
  api.ts               真实后端调用
  api.mock.ts          离线演示模式的假数据
  components/          所有页面，按角色分
  hooks/useCamera.ts   摄像头封装
main.py                后端所有逻辑（待拆分）
data/exam_system.db    SQLite，运行时生成
```

## 协议

MIT。

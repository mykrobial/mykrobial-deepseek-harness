# Agent Note: 将组件演化历史保存在可回退状态之外

Status: implemented

[English](2026-09-01-component-guardian-history-outside-rewind.md) | 中文

## 问题

DeepSeek Harness 可以替换 Cordis 组件并恢复先前的组件代次，而 Mykrobial 组件 RSI 包可以准备组件级实验与重配置计划。仅依赖组件快照无法保留可信的学习历史，因为回退组件的同一操作也可能删除失败尝试、预测与证据，从而失去阻止递归循环重复所需的信息。

外部 Exo 证据展示了一个有用的分离方式：可变执行可以制作快照并回退，而标准历史保留在回退范围之外。复制 Exo 运行时会创建第二个 harness 核心，并绕过现有的 DeepSeek 会话、CORDIS 生命周期、Mykrobial trajectory、Trace v2.3 与权限所有者。

## 决定

[`ComponentEvolutionGuardian`](../../../../packages/mykrobial/component-lifecycle/src/index.ts) 为一个组件、任务 capsule 与 loadout 保存只追加且内容寻址的历史。它创建一个确定性的基线事件，为后续事件分配序号与前一事件摘要，拒绝重复事件标识与倒退时间戳，并把每个变更事实绑定到组件快照、trajectory-event、Trace v2.3 intent 与证据摘要。

guardian 从事件链派生已知快照、候选尝试与精确候选加提案关联索引。激活必须指向此前为该候选记录的提案。它对总事件数和单个候选的尝试次数施加有限上限，而 [`rehydrate`](../../../../packages/mykrobial/component-lifecycle/src/index.ts) 会重放每个事件并重建这些索引，然后才接受序列化快照。激活、回退或重启都不会删除先前的 guardian 事件。

guardian 仅针对已记录快照和当前历史头准备 `rewind_component` 与 `rebuild_and_restart_component` 命令。这些命令保持 `prepared_unexecuted`，将组件应用、重启、历史改写、Trace 追加与部署权限维持为 false，并把任何外部状态回退收据标记为未验证。现有组件激活事务仍是唯一的组件效果执行器，并继续要求独立 permit 验证器。

[`component-guardian-runtime.v1.schema.json`](../../../../contracts/mykrobial/component-guardian-runtime.v1.schema.json) 封闭公开事件、快照与命令对象。[`external-harness-event-adapter`](../../../../packages/mykrobial/external-harness-event-adapter/README.md) 继续作为隔离的 Exo 证据桥；此实现不复制任何 Exo 代码、prompt、schema 或运行时，也不创建平行的标准事件存储。

## 曾考虑的替代方案

**把演化历史存入组件快照。** 不予采用，因为回退组件会删除解释某一代次失败原因的证据，并可能让同一候选循环在无法检测的情况下重复。

**复制或运行 Exo 作为自我改进核心。** 不予采用，因为 DeepSeek Harness 与 Cordis 已拥有组合和生命周期，Mykrobial trajectory 与 Trace 已拥有共享证据。第二个核心会分裂 replay、权限与 rollback 真相。

**允许优化器直接变更组件。** 不予采用，因为优化器建议是不可信输入。组件激活事务必须在触碰效果前验证一个独立且精确的 permit。

**只记录整个 harness 的演化。** 不予采用，因为 prompt、skill、tool、route、adapter、memory、guardrail、UI projection、loadout 与 harness 代码都需要独立的任务级实验和回退历史。

## 影响

每个已注册组件都可以保留自己的有限演化谱系，同时继续通过现有 CORDIS 生命周期进行替换。失败或受污染的代次在组件回退或重建后仍然可见，确定性重新载入会拒绝被改动的顺序、索引或哈希。

guardian 不是持久存储、优化器、评估器、Trace sink、权限验证器或重启 adapter。运行时集成必须把已封存快照存放在组件效果之外，通过各自所有者追加对应的共享 trajectory 与 Trace 事件，并把准备好的命令提交给另行获准的激活路径。

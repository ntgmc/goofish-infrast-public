# 森空岛绑定角色接口 `defaultUid` 兼容方案

本文记录森空岛绑定角色接口在不同账号数据下的返回差异、常见踩坑原因，以及一套可迁移到其他项目的解析方案。

适用接口：

```text
GET https://zonai.skland.com/api/v1/game/player/binding
```

适用场景：

- 使用森空岛凭据读取已绑定游戏角色。
- 需要从绑定列表中取出明日方舟 UID，再调用玩家数据、干员数据、养成库存等接口。
- 同一个森空岛账号可能同时绑定明日方舟和明日方舟：终末地。

## 问题现象

森空岛 `player/binding` 返回的 `data.list` 中，明日方舟条目可能出现两种形态。

一种是 `defaultUid` 为有效 UID：

```json
{
  "appCode": "arknights",
  "appName": "明日方舟",
  "bindingList": [
    {
      "uid": "123456789",
      "nickName": "雪糕我只吃铃兰的#5776",
      "channelName": "官服"
    }
  ],
  "defaultUid": "123456789"
}
```

另一种是 `defaultUid` 为空字符串，真实 UID 只在 `bindingList` 中：

```json
{
  "appCode": "arknights",
  "appName": "明日方舟",
  "bindingList": [
    {
      "uid": "987654321",
      "nickName": "晓晗#7658",
      "channelName": "官服"
    }
  ],
  "defaultUid": ""
}
```

同一次响应里还可能有 `endfield`：

```json
{
  "appCode": "endfield",
  "appName": "明日方舟：终末地",
  "bindingList": [
    {
      "uid": "123456789",
      "defaultRole": {
        "roleId": "0987654321",
        "nickname": "晓晗"
      }
    }
  ]
}
```

如果项目只支持明日方舟，`endfield` 应视为干扰项，不应用它的 `uid`、`roles` 或 `defaultRole` 填补明日方舟 UID。

## 根因

很多项目会写出类似逻辑：

```ts
const first = item.bindingList.find(isRecord)
const uid = stringValue(item.defaultUid ?? first?.uid)
```

这段代码的问题是：`??` 只会在左侧为 `null` 或 `undefined` 时回退。森空岛返回 `defaultUid: ""` 时，空字符串不是 `null`/`undefined`，所以不会回退到 `bindingList[0].uid`。

结果是：

- `uid` 被解析为空字符串。
- 后续逻辑认为没有找到明日方舟绑定角色。
- 服务端可能返回 400/500，前端表现为“森空岛导入失败”或 “Internal server error”。

## 推荐解析规则

只从 `appCode === "arknights"` 的条目中选择 UID。

选择顺序：

1. 找到 `data.list` 中 `appCode === "arknights"` 且 `bindingList` 是数组的条目。
2. 将 `defaultUid` 先归一化为字符串并 trim。
3. 如果 `defaultUid` 非空，优先选择 `bindingList` 中 `uid === defaultUid` 的绑定。
4. 如果 `defaultUid` 非空但找不到匹配绑定，回退到明日方舟 `bindingList` 的第一条对象记录。
5. 如果 `defaultUid` 为空、缺失或 `null`，选择明日方舟 `bindingList` 中第一条带有效 `uid` 的记录。
6. 最终 UID 使用 `defaultUid || selectedBinding.uid`。
7. 昵称、渠道等展示信息应来自选中的明日方舟绑定记录。
8. 不要用 `endfield` 的 `uid`、`roles`、`defaultRole` 作为明日方舟 UID 的 fallback。
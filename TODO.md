# TODO

- [ ] **TODO**:实现Image Preivew中的焦点缩放
- [x] **TODO**:禁用Image Preivew的缩放倍数小于1
- [x] **TODO**:preview窗口关闭时，让页面的定位到preview窗口关闭前展示的文件的位置
- [ ] **TODO**:实现文件的拖拽功能，用于拖动移动文件
- [ ] **TODO**:~~页面全局的快捷手势，例如快捷后退前进~~
- [ ] **TODO**:后端实现回收站机制
- [x] **TODO**:视频点击关闭工具栏
- [x] **TODO**:Image View下，让epub文件显示封面
- [x] **TODO**:允许backend中files的api不通过index直接返回文件夹内容
- [x] **TODO**:让search的api支持ImageOnlyMode
- [x] **TODO**:实现Audio Preivew组件
- [x] **TODO**:实现PDF Preivew组件
- [x] **TODO**:实现Epub Preivew组件
- [x] **TODO**:让epubReader接管处理close、download、fullscreen与keyboard event
- [ ] **TODO**:~~让page中的双击功能只在合适的区域中点击才有效~~
- [ ] **TODO**:在PreviewBase中，添加对移动端浏览器下拉刷新的禁用功能
- [ ] **TODO**:实现对OFFICE文档的预览
- [ ] **TODO**:实现对URL的预览
- [ ] **TODO**:实现对多根目录的支持
- [ ] **TODO**:实现VideoOnly与AudioOnly模式

# BUG

- [x] **BUG**:upload大文件时报错
- [x] **BUG**:处理Image Preivew中，使用拖拽时，图片拖动范围仍可能会超出窗口范围
- [ ] **BUG**:image view模式下，浏览器默认的图片拖动事件将会错误地触发文件拖拽上传功能
- [x] **BUG**: 在selection状态时允许navigate可能会导致预想不到的错误，应该禁止在selection状态时navigate，或者在navigate时自动取消selection状态
- [x] **BUG**: NavigatePreview时存在更新卡顿的情况
- [x] **BUG**:preview关闭后的第一次浏览器回退无法触发
- [x] **BUG**:用户在登录后，在使用下载时会触发浏览器登录窗口，要求再次登录
- [ ] **BUG**:在PDF preview中，若焦点被iframe获取，则无法响应键盘事件
- [x] **BUG**:页面在切换路径时，存在页面闪烁问题
- [x] **BUG**:imageOnlyMode在切换时，存在页面闪烁问题
- [x] **BUG**:搜索框的右键点击事件会因被directionMenu拦截而失效
- [ ] **BUG**:~~非递归搜索时，搜索结果不包括文件夹~~

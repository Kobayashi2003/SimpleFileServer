# ISSUE

## 1 ~Wather的错误处理~（已修改，待测试）

node:events:485
      throw er; // Unhandled 'error' event
      ^

Error: EPERM: operation not permitted, watch
    at FSWatcher._handle.onchange (node:internal/fs/watchers:207:21)
Emitted 'error' event on FSWatcher instance at:
    at FSWatcher._handle.onchange (node:internal/fs/watchers:213:12) {
  errno: -4048,
  syscall: 'watch',
  code: 'EPERM',
  filename: null
}

Node.js v24.1.0
[nodemon] app crashed - waiting for file changes before starting...


## 2 内存过量使用

 658860 [main] file 49076 cygwin program: *** fatal error - Internal error: Out of memory for new path buf.
 926065 [main] file 37540 cygwin program: *** fatal error - Internal error: Out of memory for new wide path buf.
 985332 [main] file 35164 cygwin program: *** fatal error - Internal error: Out of memory for new path buf.
 128116 [main] file 53072 exception::handle: Exception: STATUS_ACCESS_VIOLATION
1149823 [main] file 34768 exception::handle: Exception: STATUS_ACCESS_VIOLATION
1043728 [main] file 24568 D:\Program\Code\SimpleFileServer\backend\node_modules\mime-magic\bin\file.exe: *** fatal error - internal error reading the windows environment - too many environment variables?
 774489 [main] file 41652 D:\Program\Code\SimpleFileServer\backend\node_modules\mime-magic\bin\file.exe: *** fatal error - internal error reading the windows environment - too many environment variables?
3845665 [main] file 52272 exception::handle: Exception: STATUS_ACCESS_VIOLATION
[nodemon] app crashed - waiting for file changes before starting...

这个问题会出现在生成压缩包文件时，需要优化

## thumbnail的生成有路径的bug
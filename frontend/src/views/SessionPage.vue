<template>
  <div class="session-container">
    <!-- 移动端优化的头部 -->
    <div class="session-header">
      <!-- 左上角菜单按钮 -->
      <div class="header-menu-button" @click="toggleInfoPanel">
        <el-icon :size="18"><Operation /></el-icon>
      </div>

      <!-- 占位区域 -->
      <div class="header-spacer"></div>

      <!-- 离开会话按钮 -->
      <div class="header-actions">
        <el-button @click="leaveSession" type="danger" size="small" plain>离开</el-button>
      </div>
    </div>


    <!-- 消息区域 -->
    <div
      class="message-area"
      ref="messageAreaRef"
      @dragover.prevent="handleDragOver"
      @dragenter.prevent="handleDragEnter"
      @dragleave.prevent="handleDragLeave"
      @drop.prevent="handleDrop"
      :class="{ 'drag-active': isDragActive }"
    >
      <div v-if="history.length === 0" class="no-messages">
        <div class="welcome-message">
          <p class="welcome-text">开始发送消息或文件吧！</p>
          <p class="drag-hint">也可以拖拽文件到这里上传</p>
        </div>
      </div>
      <div v-else class="messages-list">
        <div 
          v-for="msg in history" 
          :key="msg.id || msg.timestamp" 
          class="message-bubble-wrapper"
          :class="{ 'is-self': msg.sender === clientToken }"
        >
          <div class="message-bubble">
            <!-- Text Message -->
            <div v-if="msg.type === 'text'" class="message-content">{{ msg.content }}</div>
            <!-- File Message -->
            <div v-else-if="msg.type === 'file'" class="file-content">
              <!-- Image Preview -->
              <div v-if="isImageFile(msg.metadata)" class="image-content">
                <img
                  v-if="msg.imagePreview"
                  :src="msg.imagePreview"
                  @click="showImageViewer(msg)"
                  class="image-preview"
                  :alt="msg.metadata.name"
                />
                <div v-else class="image-placeholder">
                  <el-icon :size="40"><Picture /></el-icon>
                </div>
                <div class="media-info">
                  <div class="file-name">{{ msg.metadata.name }}</div>
                  <div class="file-size">
                    {{ formatFileSize(msg.metadata.size) }}
                    <span v-if="msg.isChunkedUpload" class="chunked-badge">分块上传</span>
                  </div>
                </div>
              </div>

              <!-- Video Preview -->
              <div v-else-if="isVideoFile(msg.metadata)" class="video-content">
                <video
                  v-if="msg.mediaPreview"
                  :src="msg.mediaPreview"
                  class="video-preview"
                  controls
                  preload="metadata"
                >
                  您的浏览器不支持视频播放
                </video>
                <div v-else-if="msg.isLoadingPreview" class="video-placeholder loading">
                  <el-icon :size="40" class="rotating"><Loading /></el-icon>
                  <div class="preview-hint">正在加载...</div>
                </div>
                <div v-else class="video-placeholder" @click="generateMediaPreview(msg)">
                  <el-icon :size="40"><VideoPlay /></el-icon>
                  <div class="preview-hint">点击预览</div>
                </div>
                <div class="media-info">
                  <div class="file-name">{{ msg.metadata.name }}</div>
                  <div class="file-size">
                    {{ formatFileSize(msg.metadata.size) }}
                    <span v-if="msg.isChunkedUpload" class="chunked-badge">分块上传</span>
                  </div>
                </div>
              </div>

              <!-- Audio Preview -->
              <div v-else-if="isAudioFile(msg.metadata)" class="audio-content">
                <audio
                  v-if="msg.mediaPreview"
                  :src="msg.mediaPreview"
                  class="audio-preview"
                  controls
                  preload="metadata"
                >
                  您的浏览器不支持音频播放
                </audio>
                <div v-else-if="msg.isLoadingPreview" class="audio-placeholder loading">
                  <el-icon :size="40" class="rotating"><Loading /></el-icon>
                  <div class="preview-hint">正在加载...</div>
                </div>
                <div v-else class="audio-placeholder" @click="generateMediaPreview(msg)">
                  <el-icon :size="40"><Microphone /></el-icon>
                  <div class="preview-hint">点击预览</div>
                </div>
                <div class="media-info">
                  <div class="file-name">{{ msg.metadata.name }}</div>
                  <div class="file-size">
                    {{ formatFileSize(msg.metadata.size) }}
                    <span v-if="msg.isChunkedUpload" class="chunked-badge">分块上传</span>
                  </div>
                </div>
              </div>

              <!-- Regular File -->
              <div v-else class="regular-file-content">
                <el-icon :size="40">
                  <component :is="getFileIcon(msg.metadata)" />
                </el-icon>
                <div class="file-info">
                  <div class="file-name">{{ msg.metadata.name }}</div>
                  <div class="file-size">
                    {{ formatFileSize(msg.metadata.size) }}
                    <span v-if="msg.isChunkedUpload" class="chunked-badge">分块上传</span>
                  </div>
                </div>
              </div>

              <!-- Progress or Download Button -->
              <el-progress v-if="msg.progress > 0 && msg.progress < 100" :percentage="msg.progress" class="file-progress" />
              <el-button v-else @click="downloadFile(msg)" :loading="msg.isDownloading">下载</el-button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Drag Overlay -->
      <div v-if="isDragActive" class="drag-overlay">
        <div class="drag-content">
          <el-icon :size="80"><Upload /></el-icon>
          <p>松开以上传文件</p>
        </div>
      </div>
    </div>

    <!-- 输入区域 -->
    <div class="message-input-area">
      <input type="file" ref="fileInputRef" @change="handleFileSelect" multiple style="display: none" />
      <el-button @click="triggerFileInput" :icon="Paperclip" circle size="small" />
      <el-input
        v-model="newMessage"
        placeholder="输入消息..."
        @keydown="handleKeyDown"
        class="message-input"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        resize="none"
      />
      <el-button type="primary" @click="sendMessage" :disabled="!newMessage.trim()" size="small">发送</el-button>
    </div>
  </div>

  <!-- 信息弹窗 - 左上角小弹窗 -->
  <div v-if="showInfoPanel" class="info-popup-overlay" @click="closeInfoPanel">
    <div class="info-popup" @click.stop>
      <div class="info-popup-header">
        <span class="popup-title">会话信息</span>
        <el-button @click="closeInfoPanel" :icon="Close" size="small" text />
      </div>

      <div class="info-popup-content">
        <div class="popup-item">
          <div class="popup-label">匹配码</div>
          <div class="popup-value match-code-popup" @click="copyMatchCode" title="点击复制">{{ matchCode }}</div>
        </div>

        <div class="popup-item" v-if="!storageUsage.loading">
          <div class="popup-label">存储</div>
          <div class="storage-popup">
            <div class="storage-text-popup">
              {{ storageUsage.formattedUsage }} / {{ storageUsage.formattedLimit }}
            </div>
            <el-progress
              v-if="!storageUsage.isUnlimited"
              :percentage="storageUsage.usagePercentage"
              :stroke-width="4"
              :show-text="false"
              :color="storageUsage.usagePercentage > 90 ? '#F56C6C' : storageUsage.usagePercentage > 70 ? '#E6A23C' : '#67C23A'"
              class="storage-progress-popup"
            />
            <div v-else class="unlimited-popup">∞</div>
          </div>
        </div>

        <div class="popup-item">
          <div class="popup-label">状态</div>
          <el-tag :type="connectionStatus.type" size="small">{{ connectionStatus.text }}</el-tag>
        </div>
      </div>
    </div>
  </div>

  <!-- Image Viewer -->
  <el-image-viewer
    v-if="imageViewerVisible"
    :url-list="[currentImageUrl]"
    @close="closeImageViewer"
  />
</template>

<script setup>
import { ref, reactive, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { ElMessage, ElImageViewer } from 'element-plus';
import { Document, Paperclip, Picture, Upload, VideoPlay, Microphone, Loading, Operation, Close } from '@element-plus/icons-vue';
import { socket } from '../services/socket';
import api from '../services/api';
import crypto from '../services/crypto';
import { ChunkedUploader } from '../services/chunkedUpload';
import { validateFile, formatFileSize } from '../config/upload';
import { setSessionCookie, deleteSessionCookie, refreshSessionCookie } from '../utils/cookies';

// 声明 props
const props = defineProps({
  matchCode: {
    type: String,
    required: true
  },
  sessionToken: {
    type: String,
    required: false
  }
});

const router = useRouter();
const route = useRoute();
const matchCode = ref(props.matchCode.toUpperCase());
const clientToken = ref(sessionStorage.getItem(matchCode.value));
const history = reactive([]);
const newMessage = ref('');
const fileInputRef = ref(null);
const messageAreaRef = ref(null);
const isDragActive = ref(false);
const imageViewerVisible = ref(false);
const currentImageUrl = ref('');
const showInfoPanel = ref(false);

// 检测是否为移动设备
const isMobile = ref(false);

// 检测设备类型
function detectDevice() {
  const userAgent = navigator.userAgent.toLowerCase();
  const isMobileDevice = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent);
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  isMobile.value = isMobileDevice || isTouchDevice;
}

const connectionStatus = reactive({
  type: 'info',
  text: '正在连接...'
});

const storageUsage = reactive({
  currentUsage: 0,
  limit: 0,
  fileCount: 0,
  formattedUsage: '0 B',
  formattedLimit: '0 B',
  usagePercentage: 0,
  isUnlimited: false,
  loading: false
});

// Cookie刷新定时器
let cookieRefreshTimer = null;

// --- Lifecycle and Connection ---
onMounted(() => {
  // 检测设备类型
  detectDevice();

  // 验证是否有有效的匹配码
  if (!matchCode.value || matchCode.value.length !== 6) {
    ElMessage.error('无效的会话访问');
    router.push('/');
    return;
  }

  // 重置连接状态
  connectionStatus.type = 'info';
  connectionStatus.text = '正在连接...';

  socket.connect();
  socket.on('connect', () => {
    connectionStatus.text = '正在加入房间...';
    socket.emit('joinRoom', { code: matchCode.value, clientToken: clientToken.value });
  });
  socket.on('sessionJoined', handleSessionJoined);
  socket.on('receiveMessage', handleReceiveMessage);
  socket.on('userConnected', () => { connectionStatus.text = '双方已连接'; });
  socket.on('userDisconnected', () => { connectionStatus.text = '对方已离线'; });
  socket.on('error', (e) => {
    ElMessage.error(e.message);
    // 如果会话错误，可能是无效的匹配码，返回主页
    if (e.message.includes('无效') || e.message.includes('不存在')) {
      setTimeout(() => {
        router.push('/');
      }, 2000);
    }
  });
  socket.on('disconnect', () => { connectionStatus.text = '已断开连接'; });
});

onUnmounted(() => {
  socket.disconnect();

  // 清除cookie刷新定时器
  if (cookieRefreshTimer) {
    clearInterval(cookieRefreshTimer);
    cookieRefreshTimer = null;
  }

  // 清除会话cookie
  deleteSessionCookie();

  // 清理本地状态
  history.splice(0, history.length);
});

// --- Storage Usage ---
async function fetchStorageUsage() {
  if (!matchCode.value) return;

  try {
    storageUsage.loading = true;
    const usage = await api.getSessionStorageUsage(matchCode.value);
    Object.assign(storageUsage, {
      currentUsage: usage.currentUsage,
      limit: usage.limit,
      fileCount: usage.fileCount,
      formattedUsage: usage.formattedUsage,
      formattedLimit: usage.formattedLimit,
      usagePercentage: usage.usagePercentage,
      isUnlimited: usage.isUnlimited || false,
      loading: false
    });
  } catch (error) {
    console.error('Failed to fetch storage usage:', error);
    storageUsage.loading = false;
  }
}

// --- Handlers ---
function handleSessionJoined(data) {
  clientToken.value = data.clientToken;
  sessionStorage.setItem(matchCode.value, data.clientToken);

  // 清空现有历史记录并替换为服务器返回的历史记录
  history.splice(0, history.length, ...data.history);

  // 设置会话cookie，允许页面刷新
  const sessionToken = props.sessionToken || route.params.sessionToken;
  if (sessionToken) {
    setSessionCookie(matchCode.value, data.clientToken, sessionToken);

    // 启动cookie刷新定时器（每10分钟刷新一次）
    cookieRefreshTimer = setInterval(() => {
      refreshSessionCookie();
    }, 10 * 60 * 1000); // 10分钟
  }

  // 显示成功加入会话的消息
  console.log('Successfully joined session:', matchCode.value);

  // 为历史消息中的媒体文件生成预览
  data.history.forEach(message => {
    if (message.type === 'file') {
      // 使用 nextTick 确保 DOM 更新后再生成预览
      nextTick(() => {
        if (isImageFile(message.metadata)) {
          generateImagePreview(message);
        } else if (isMediaFile(message.metadata)) {
          // 自动生成媒体预览（小文件）
          generateMediaPreview(message, true);
        }
      });
    }
  });

  connectionStatus.type = 'success';
  connectionStatus.text = '已连接';

  // 获取存储使用情况
  fetchStorageUsage();

  scrollToBottom();
}

function handleReceiveMessage(message) {
  // 如果是自己发送的消息，跳过处理（避免重复显示）
  if (message.sender === clientToken.value) {
    return;
  }

  // 检查是否已存在相同的消息（避免重复添加）
  const existingIndex = history.findIndex(m =>
    m.timestamp === message.timestamp &&
    m.sender === message.sender &&
    m.type === message.type &&
    (m.type === 'text' ? m.content === message.content :
     m.type === 'file' ? m.metadata?.name === message.metadata?.name : true)
  );

  if (existingIndex !== -1) {
    // 更新现有消息
    Object.assign(history[existingIndex], message);

    // 如果是图片文件且还没有预览，生成预览
    if (message.type === 'file' && isImageFile(message.metadata) && !history[existingIndex].imagePreview) {
      generateImagePreview(history[existingIndex]);
    }

    // 如果是媒体文件且还没有预览，生成预览
    if (message.type === 'file' && isMediaFile(message.metadata) && !history[existingIndex].mediaPreview) {
      generateMediaPreview(history[existingIndex], true);
    }
  } else {
    // 添加新消息
    history.push(message);

    // 如果是图片文件，生成预览
    if (message.type === 'file' && isImageFile(message.metadata)) {
      generateImagePreview(message);
    }

    // 如果是媒体文件，生成预览
    if (message.type === 'file' && isMediaFile(message.metadata)) {
      generateMediaPreview(message, true);
    }
  }
  scrollToBottom();
}

// --- Text Messaging ---
function handleKeyDown(event) {
  if (event.key === 'Enter') {
    if (isMobile.value) {
      // 移动端：Enter键不发送，只换行
      return;
    } else {
      // 桌面端：Enter发送，Shift+Enter换行
      if (event.shiftKey) {
        // Shift+Enter：换行，不阻止默认行为
        return;
      } else {
        // 单独Enter：发送消息
        event.preventDefault();
        sendMessage();
      }
    }
  }
}

function sendMessage() {
  const content = newMessage.value.trim();
  if (!content) return;

  const message = {
    type: 'text',
    content,
    sender: clientToken.value,
    timestamp: Date.now()
  };

  // 立即添加到本地历史记录
  history.push(message);
  scrollToBottom();

  // 发送到服务器
  socket.emit('sendMessage', { matchCode: matchCode.value, clientToken: clientToken.value, message });
  newMessage.value = '';
}

// --- File Handling ---
function triggerFileInput() {
  fileInputRef.value.click();
}

async function handleFileSelect(event) {
  const files = Array.from(event.target.files);
  await processFiles(files);
  // 清空文件选择，允许重复选择同一文件
  event.target.value = '';
}

// 分块上传辅助函数
async function uploadFileChunked(encryptedFile, fileMessage) {
  const uploader = new ChunkedUploader({
    sessionId: matchCode.value,
    onProgress: (progressInfo) => {
      fileMessage.progress = progressInfo.percentage;
    },
    onError: (error) => {
      console.error('Chunked upload error:', error);
    }
  });

  return await uploader.upload(encryptedFile);
}

async function processFiles(files) {
  for (const file of files) {
    // 验证文件
    const validation = validateFile(file);
    if (!validation.valid) {
      ElMessage.error(`文件 ${file.name} 验证失败: ${validation.errors.join(', ')}`);
      continue;
    }

    const fileId = `${Date.now()}-${Math.random()}`;
    const isChunkedUpload = ChunkedUploader.shouldUseChunkedUpload(file);

    const fileMessage = reactive({
      id: fileId,
      type: 'file',
      sender: clientToken.value,
      timestamp: Date.now(),
      progress: 0,
      isChunkedUpload,
      metadata: {
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream'
      },
    });

    // 立即添加到历史记录并显示进度
    history.push(fileMessage);

    // 如果是图片，生成预览
    if (isImageFile({ type: file.type })) {
      generateLocalImagePreview(fileMessage, file);
    }

    // 如果是媒体文件，生成预览
    if (isMediaFile({ type: file.type })) {
      generateLocalMediaPreview(fileMessage, file);
    }

    scrollToBottom();

    try {
      const key = await crypto.generateKey();
      const exportedKey = await crypto.exportKey(key);

      const fileBuffer = await file.arrayBuffer();
      const encryptedBuffer = await crypto.encrypt(fileBuffer, key);

      // 创建一个新的File对象，保持原始文件名
      const encryptedFile = new File([encryptedBuffer], file.name, {
        type: file.type || 'application/octet-stream'
      });

      let uploadedFileData;

      // 根据文件大小选择上传方式
      if (isChunkedUpload) {
        // 使用分块上传
        uploadedFileData = await uploadFileChunked(encryptedFile, fileMessage);
      } else {
        // 使用普通上传
        uploadedFileData = await api.uploadFile(encryptedFile, (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          fileMessage.progress = percentCompleted;
        }, matchCode.value);
      }

      // 更新消息元数据
      Object.assign(fileMessage.metadata, {
        ...uploadedFileData,
        key: exportedKey,
        name: file.name,
        type: file.type,
        mimeType: file.type
      });
      fileMessage.progress = 100;

      // 添加发送者和时间戳信息
      fileMessage.sender = clientToken.value;
      fileMessage.timestamp = Date.now();

      // 发送到服务器
      const finalMessage = {
        type: 'file',
        sender: clientToken.value,
        timestamp: fileMessage.timestamp,
        metadata: {
          ...uploadedFileData,
          key: exportedKey,
          name: file.name,
          type: file.type,
          mimeType: file.type
        },
      };

      socket.emit('sendMessage', { matchCode: matchCode.value, clientToken: clientToken.value, message: finalMessage });

      // 更新存储使用情况
      fetchStorageUsage();
    } catch (err) {
      console.error("File handling failed:", err);
      ElMessage.error(`处理文件 ${file.name} 时出错`);
      // 从历史记录中移除失败的文件
      const index = history.findIndex(m => m.id === fileId);
      if (index !== -1) history.splice(index, 1);
    }
  }
}

async function downloadFile(msg) {
  try {
    msg.isDownloading = true;
    const encryptedBuffer = await api.downloadFile(msg.metadata.downloadUrl);

    const key = await crypto.importKey(msg.metadata.key);
    const decryptedBuffer = await crypto.decrypt(encryptedBuffer, key);

    const blob = new Blob([decryptedBuffer], { type: msg.metadata.mimeType || msg.metadata.type });

    // 如果是图片文件且还没有预览，生成预览
    if (isImageFile(msg.metadata) && !msg.imagePreview) {
      msg.imagePreview = URL.createObjectURL(blob.slice());
    }

    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = msg.metadata.name;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  } catch (err) {
    console.error("Download failed:", err);
    ElMessage.error(`下载文件 ${msg.metadata.name} 失败`);
  } finally {
    msg.isDownloading = false;
  }
}

// --- Drag and Drop ---
function handleDragOver(e) {
  e.preventDefault();
}

function handleDragEnter(e) {
  e.preventDefault();
  isDragActive.value = true;
}

function handleDragLeave(e) {
  e.preventDefault();
  // 只有当离开整个拖拽区域时才隐藏覆盖层
  const messageArea = messageAreaRef.value;
  if (!e.relatedTarget || !messageArea || !(messageArea.$el || messageArea)?.contains?.(e.relatedTarget)) {
    isDragActive.value = false;
  }
}

async function handleDrop(e) {
  e.preventDefault();
  isDragActive.value = false;
  
  const files = Array.from(e.dataTransfer.files);
  if (files.length > 0) {
    await processFiles(files);
  }
}

// --- Image Handling ---
function isImageFile(metadata) {
  if (!metadata || !metadata.type) return false;
  return metadata.type.startsWith('image/');
}

function isVideoFile(metadata) {
  if (!metadata || !metadata.type) return false;
  return metadata.type.startsWith('video/');
}

function isAudioFile(metadata) {
  if (!metadata || !metadata.type) return false;
  return metadata.type.startsWith('audio/');
}

function isMediaFile(metadata) {
  return isVideoFile(metadata) || isAudioFile(metadata);
}

function getFileIcon(metadata) {
  if (!metadata || !metadata.type) return Document;

  const type = metadata.type.toLowerCase();

  // 图片文件
  if (type.startsWith('image/')) {
    return Picture;
  }

  // 文档文件（PDF、Office文档等）
  if (type.includes('pdf') || type.includes('doc') || type.includes('text') ||
      type.includes('excel') || type.includes('powerpoint') || type.includes('csv')) {
    return Document;
  }

  // 其他所有文件类型使用默认图标
  return Paperclip;
}

function generateLocalImagePreview(fileMessage, file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    fileMessage.imagePreview = e.target.result;
  };
  reader.readAsDataURL(file);
}

function generateLocalMediaPreview(fileMessage, file) {
  try {
    const previewUrl = URL.createObjectURL(file);
    fileMessage.mediaPreview = previewUrl;
  } catch (error) {
    console.error('Failed to generate local media preview:', error);
  }
}

async function generateImagePreview(message) {
  if (!message.metadata || !message.metadata.downloadUrl || !message.metadata.key) {
    return;
  }

  // 如果已经有预览，不重复生成
  if (message.imagePreview) {
    return;
  }

  try {
    const encryptedBuffer = await api.downloadFile(message.metadata.downloadUrl);
    const key = await crypto.importKey(message.metadata.key);
    const decryptedBuffer = await crypto.decrypt(encryptedBuffer, key);

    const blob = new Blob([decryptedBuffer], { type: message.metadata.mimeType || message.metadata.type });
    const previewUrl = URL.createObjectURL(blob);

    // 找到历史记录中对应的消息并更新
    const messageIndex = history.findIndex(m =>
      m.timestamp === message.timestamp &&
      m.sender === message.sender &&
      m.type === 'file' &&
      m.metadata?.name === message.metadata?.name
    );

    if (messageIndex !== -1) {
      // 直接更新历史记录中的消息
      history[messageIndex].imagePreview = previewUrl;
    } else {
      // 如果没找到，直接更新传入的消息对象
      message.imagePreview = previewUrl;
    }
  } catch (err) {
    console.error("Failed to generate image preview for", message.metadata.name, ":", err);
  }
}

async function generateMediaPreview(message, autoGenerate = false) {
  if (!message.metadata || !message.metadata.downloadUrl || !message.metadata.key) {
    return;
  }

  // 如果已经有预览，不重复生成
  if (message.mediaPreview) {
    return;
  }

  // 如果是自动生成且文件过大（超过50MB），跳过自动预览
  if (autoGenerate && message.metadata.size > 50 * 1024 * 1024) {
    return;
  }

  // 显示加载状态
  message.isLoadingPreview = true;

  try {
    const encryptedBuffer = await api.downloadFile(message.metadata.downloadUrl);
    const key = await crypto.importKey(message.metadata.key);
    const decryptedBuffer = await crypto.decrypt(encryptedBuffer, key);

    const blob = new Blob([decryptedBuffer], { type: message.metadata.mimeType || message.metadata.type });
    const previewUrl = URL.createObjectURL(blob);

    // 找到历史记录中对应的消息并更新
    const messageIndex = history.findIndex(m =>
      m.timestamp === message.timestamp &&
      m.sender === message.sender &&
      m.type === 'file' &&
      m.metadata?.name === message.metadata?.name
    );

    if (messageIndex !== -1) {
      // 直接更新历史记录中的消息
      history[messageIndex].mediaPreview = previewUrl;
      history[messageIndex].isLoadingPreview = false;
    } else {
      // 如果没找到，直接更新传入的消息对象
      message.mediaPreview = previewUrl;
      message.isLoadingPreview = false;
    }
  } catch (err) {
    console.error("Failed to generate media preview for", message.metadata.name, ":", err);
    message.isLoadingPreview = false;
    if (!autoGenerate) {
      ElMessage.error(`无法预览 ${message.metadata.name}`);
    }
  }
}

function showImageViewer(msg) {
  if (msg.imagePreview) {
    currentImageUrl.value = msg.imagePreview;
    imageViewerVisible.value = true;
  }
}

function closeImageViewer() {
  imageViewerVisible.value = false;
  currentImageUrl.value = '';
}

// --- UI Management ---
function toggleInfoPanel() {
  showInfoPanel.value = !showInfoPanel.value;
}

function closeInfoPanel() {
  showInfoPanel.value = false;
}

async function copyMatchCode() {
  try {
    await navigator.clipboard.writeText(matchCode.value);
    ElMessage.success('匹配码已复制到剪贴板');
  } catch (err) {
    // 降级方案：使用传统的复制方法
    const textArea = document.createElement('textarea');
    textArea.value = matchCode.value;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      ElMessage.success('匹配码已复制到剪贴板');
    } catch (fallbackErr) {
      ElMessage.error('复制失败，请手动复制');
    }
    document.body.removeChild(textArea);
  }
}

// --- Session Management ---
function leaveSession() {
  // 清除cookie刷新定时器
  if (cookieRefreshTimer) {
    clearInterval(cookieRefreshTimer);
    cookieRefreshTimer = null;
  }

  // 清除会话cookie
  deleteSessionCookie();

  // 清理本地状态
  history.splice(0, history.length);
  clientToken.value = null;

  // 断开socket连接
  socket.disconnect();

  // 返回主页
  router.push('/');
}

// --- Utils ---
// formatFileSize 函数已从 config/upload.js 导入

function scrollToBottom() {
  nextTick(() => {
    if (messageAreaRef.value) {
      const el = messageAreaRef.value.$el || messageAreaRef.value;
      if (el && typeof el.scrollTop !== 'undefined') {
        el.scrollTop = el.scrollHeight;
      }
    }
  });
}
</script>

<style scoped>
.session-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 移动端优化的头部 */
.session-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid #e4e7ed;
  padding: 8px 12px;
  background: #fff;
  position: relative;
  z-index: 10;
  min-height: 44px;
  flex-shrink: 0;
}

.header-menu-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  background: #f8fafc;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  color: #64748b;
}

.header-menu-button:hover {
  background: #f1f5f9;
  border-color: #cbd5e1;
  color: #475569;
}

.header-spacer {
  flex: 1;
}

.header-actions {
  display: flex;
  align-items: center;
}

/* 左上角小弹窗样式 */
.info-popup-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.1);
  z-index: 2000;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 60px 12px 12px 12px; /* 为头部留出空间 */
}

.info-popup {
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
  border: 1px solid #e5e7eb;
  min-width: 280px;
  max-width: 320px;
  animation: popupSlideIn 0.2s ease-out;
}

@keyframes popupSlideIn {
  from {
    opacity: 0;
    transform: translateY(-10px) scale(0.95);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.info-popup-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f1f5f9;
  background: #f8fafc;
  border-radius: 12px 12px 0 0;
}

.popup-title {
  font-weight: 600;
  color: #1e293b;
  font-size: 0.9rem;
}

.info-popup-content {
  padding: 12px 16px;
}

.popup-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 12px;
}

.popup-item:last-child {
  margin-bottom: 0;
}

.popup-label {
  color: #64748b;
  font-weight: 500;
  font-size: 0.85rem;
  min-width: 50px;
  flex-shrink: 0;
}

.popup-value {
  color: #1e293b;
  font-weight: 600;
  font-size: 0.85rem;
}

.match-code-popup {
  font-family: 'Courier New', monospace;
  font-size: 0.9rem;
  color: #2563eb;
  background: #eff6ff;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #bfdbfe;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.match-code-popup:hover {
  background: #dbeafe;
  border-color: #93c5fd;
  transform: scale(1.02);
}

.storage-popup {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex: 1;
}

.storage-text-popup {
  font-size: 0.8rem;
  color: #64748b;
  font-weight: 500;
}

.storage-progress-popup {
  width: 100px;
}

.unlimited-popup {
  font-size: 16px;
  color: #16a34a;
  font-weight: bold;
}
/* 消息区域 */
.message-area {
  flex: 1;
  padding: 12px;
  background-color: #f9fafb;
  overflow-y: auto;
  position: relative;
  min-height: 0; /* 重要：允许flex子项收缩 */
}

.message-area.drag-active {
  background-color: #f0f9ff;
}

.no-messages {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none; /* 允许点击穿透到下层 */
}

.welcome-message {
  text-align: center;
  color: #909399;
  pointer-events: auto;
}

.welcome-text {
  font-size: 1.1rem;
  margin: 0 0 8px 0;
  color: #64748b;
  line-height: 1.4;
  margin-left: 14px;
}

.drag-hint {
  font-size: 0.9rem;
  color: #c0c4cc;
  margin: 0;
  line-height: 1.4;
}

.messages-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.message-bubble-wrapper {
  display: flex;
  width: 100%;
}

.message-bubble-wrapper.is-self {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 16px;
  background-color: #ffffff;
  border: 1px solid #e4e7ed;
  word-wrap: break-word;
}

.message-bubble-wrapper.is-self .message-bubble {
  background-color: #409eff;
  color: #ffffff;
}

/* 消息内容样式 */
.message-content {
  white-space: pre-wrap; /* 保留换行和空格 */
  word-wrap: break-word; /* 长单词换行 */
  line-height: 1.4; /* 行高 */
}

/* 输入区域 */
.message-input-area {
  display: flex;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #e4e7ed;
  align-items: center;
  background: #fff;
  flex-shrink: 0;
  min-height: 52px; /* 固定最小高度 */
}

.message-input {
  flex: 1;
  min-width: 0; /* 重要：允许input收缩 */
}
.file-content { 
  display: flex; 
  align-items: center; 
  gap: 10px; 
  flex-direction: column;
}
.image-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 250px;
}
.image-preview {
  max-width: 200px;
  max-height: 200px;
  border-radius: 8px;
  cursor: pointer;
  object-fit: cover;
}
.image-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 150px;
  background-color: #f5f7fa;
  border-radius: 8px;
  color: #c0c4cc;
}
.regular-file-content {
  display: flex;
  align-items: center;
  gap: 10px;
}
.file-info { 
  flex-grow: 1; 
}
.image-info, .media-info {
  text-align: center;
  width: 100%;
}
.file-name { 
  font-weight: bold; 
  word-break: break-word;
}
.file-size {
  font-size: 0.8rem;
  color: #909399;
}
.message-bubble-wrapper.is-self .file-size {
  color: #dcdfe6;
}
.chunked-badge {
  display: inline-block;
  background-color: #e6f7ff;
  color: #1890ff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  margin-left: 8px;
  border: 1px solid #91d5ff;
}
.message-bubble-wrapper.is-self .chunked-badge {
  background-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
  border-color: rgba(255, 255, 255, 0.3);
}
.file-progress { 
  width: 100px; 
  margin: 10px 0;
}
.drag-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(64, 158, 255, 0.1);
  border: 2px dashed #409eff;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.drag-content {
  text-align: center;
  color: #409eff;
}
.drag-content p {
  margin-top: 10px;
  font-size: 1.1rem;
  font-weight: 500;
}

/* 媒体预览样式 */
.video-content, .audio-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  max-width: 400px;
}

.video-preview {
  max-width: 100%;
  max-height: 300px;
  border-radius: 8px;
  background: #000;
}

.audio-preview {
  width: 100%;
  max-width: 350px;
}

.video-placeholder, .audio-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 200px;
  height: 120px;
  background: rgba(0, 0, 0, 0.1);
  border: 2px dashed #dcdfe6;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.video-placeholder:hover, .audio-placeholder:hover {
  background: rgba(64, 158, 255, 0.1);
  border-color: #409eff;
  color: #409eff;
}

.preview-hint {
  margin-top: 8px;
  font-size: 0.9rem;
  color: #909399;
}

.video-placeholder:hover .preview-hint,
.audio-placeholder:hover .preview-hint {
  color: #409eff;
}

/* 音频播放器特殊样式 */
.audio-placeholder {
  width: 300px;
  height: 80px;
}

/* 加载动画 */
.rotating {
  animation: rotate 1s linear infinite;
}

@keyframes rotate {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.loading {
  pointer-events: none;
  opacity: 0.7;
}

/* 移动端响应式样式 */
@media (max-width: 768px) {
  .session-header {
    padding: 6px 8px;
    min-height: 40px;
  }

  .header-menu-button {
    width: 32px;
    height: 32px;
  }

  /* 弹窗在移动端的样式调整 */
  .info-popup-overlay {
    padding: 50px 8px 8px 8px;
  }

  .info-popup {
    min-width: 260px;
    max-width: 300px;
  }

  .popup-item {
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
  }

  .storage-popup {
    align-items: flex-start;
    width: 100%;
  }

  .match-code-popup {
    font-size: 0.85rem;
  }

  .message-area {
    padding: 8px;
  }

  .messages-list {
    gap: 8px;
  }

  .message-bubble {
    max-width: 90%;
    padding: 6px 10px;
    border-radius: 12px;
    font-size: 0.9rem;
  }

  .message-input-area {
    padding: 6px 8px;
    gap: 6px;
    min-height: 48px;
  }

  .image-content {
    max-width: 200px;
  }

  .image-preview {
    max-width: 150px;
    max-height: 150px;
  }

  .video-content, .audio-content {
    max-width: 300px;
  }

  .video-placeholder, .audio-placeholder {
    width: 150px;
    height: 100px;
  }

  .audio-placeholder {
    width: 250px;
    height: 60px;
  }
}

/* 超小屏幕优化 */
@media (max-width: 480px) {
  .session-header {
    padding: 4px 6px;
    min-height: 36px;
  }

  .header-menu-button {
    width: 28px;
    height: 28px;
  }

  .info-popup-overlay {
    padding: 45px 6px 6px 6px;
  }

  .info-popup {
    min-width: 240px;
    max-width: 280px;
  }

  .match-code-popup {
    font-size: 0.8rem;
    padding: 3px 6px;
  }

  .message-area {
    padding: 6px;
  }

  .message-bubble {
    max-width: 95%;
    padding: 5px 8px;
    font-size: 0.85rem;
  }

  .message-input-area {
    padding: 4px 6px;
    gap: 4px;
    min-height: 44px;
  }

  .image-preview {
    max-width: 120px;
    max-height: 120px;
  }

  .video-placeholder, .audio-placeholder {
    width: 120px;
    height: 80px;
  }

  .audio-placeholder {
    width: 200px;
    height: 50px;
  }
}
</style>
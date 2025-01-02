import React, { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faPaw,
  faInfoCircle,
  faRedo,
  faEye,
  faEyeSlash,
  faGripVertical,
  faPlus,
  faTrash,
  faPause,
  faPlay,
} from '@fortawesome/free-solid-svg-icons';
import Modal from 'react-modal';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';

import styles from '../styles/Home.module.css';
import '@fortawesome/fontawesome-svg-core/styles.css';

import prompts from '../config/prompts';

Modal.setAppElement('#__next');

export default function Home() {
  // ======== 狀態管理 ========
  const [students, setStudents] = useState([]);
  const [apiKey, setApiKey] = useState('');
  const [isValidKey, setIsValidKey] = useState(null); // null 表示未驗證，true 表示有效，false 表示無效
  const [isGenerating, setIsGenerating] = useState(false); // 是否正在整批生成中
  const [isPaused, setIsPaused] = useState(false);         // 是否暫停中
  const [currentStudentIndex, setCurrentStudentIndex] = useState(0);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [commentLength, setCommentLength] = useState('short');
  const [showApiKey, setShowApiKey] = useState(false);
  const [focusedStudentIndex, setFocusedStudentIndex] = useState(null); // 焦點在哪一列的關鍵字欄位

  // 用於在「新增學生」後，自動捲動到表格底部
  const tableEndRef = useRef(null);

  const [commonTraits, setCommonTraits] = useState([
    '活潑外向',
    '心思細膩',
    '反應快',
    '樂於助人',
    '領導力佳',
    '語文能力強',
    '體育表現突出',
    '數理邏輯好',
    '藝術天份高',
    '協調性佳',
    '有潔癖',
  ]);

  // 取得當前年份
  const currentYear = new Date().getFullYear();
  const copyrightYear =
    currentYear === 2024 ? '2024' : `2024 – ${currentYear}`;

  // ======== API Key ========
  const toggleShowApiKey = () => {
    setShowApiKey((prev) => !prev);
  };
  const handleApiKeyChange = (e) => {
    const key = e.target.value;
    setApiKey(key);
    validateApiKey(key);
  };
  const validateApiKey = async (key) => {
    if (!key) {
      setIsValidKey(false);
      return;
    }
    try {
      const genAI = new GoogleGenerativeAI(key);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
      });
      const chatSession = model.startChat({
        generationConfig: { maxOutputTokens: 10 },
        history: [],
      });
      await chatSession.sendMessage('測試');
      setIsValidKey(true);
    } catch (error) {
      console.error('API Key 驗證失敗', error);
      setIsValidKey(false);
    }
  };

  // ======== 上傳 / 新增學生 ========
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      const formattedData = jsonData
        .filter((row) => row[0] || row[1])
        .map((row) => ({
          name: row[0] || '',
          keywords: row[1] || '',
          comment: '',
        }));

      setStudents(formattedData);
      setTimeout(() => {
        scrollToBottom();
      }, 200);
    };
    reader.readAsArrayBuffer(file);
  };
  const handleAddStudent = () => {
    setStudents((prev) => [...prev, { name: '', keywords: '', comment: '' }]);
    setTimeout(() => {
      scrollToBottom();
    }, 200);
  };
  const scrollToBottom = () => {
    if (tableEndRef.current) {
      tableEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  };

  // ======== 特質 ========
  const handleAddCustomTrait = () => {
    const trait = prompt('請輸入自訂的特質名稱：');
    if (trait && trait.trim()) {
      setCommonTraits((prev) => [...prev, trait.trim()]);
    }
  };
  const handleAddTraitToFocused = (trait) => {
    if (focusedStudentIndex === null) {
      alert('請先點擊欲編輯的關鍵字欄位，才能插入特質。');
      return;
    }
    setStudents((prev) => {
      const newStudents = [...prev];
      const oldKeywords = newStudents[focusedStudentIndex].keywords || '';
      const newKeywords = oldKeywords
        ? oldKeywords.trim() + '，' + trait
        : trait;
      newStudents[focusedStudentIndex].keywords = newKeywords;
      return newStudents;
    });
  };

  // ======== 編輯 ========
  const handleEditStudentField = (index, field, value) => {
    setStudents((prev) => {
      const newStudents = [...prev];
      newStudents[index][field] = value;
      return newStudents;
    });
  };
  const handleFocusKeywordField = (index) => {
    setFocusedStudentIndex(index);
  };

  // ======== 刪除學生 ========
  const handleDeleteStudent = (index) => {
    if (!window.confirm('確定要刪除此學生嗎？')) return;
    setStudents((prev) => {
      const newStudents = [...prev];
      newStudents.splice(index, 1);
      return newStudents;
    });
  };

  // ======== 生成評語流程 & 暫停繼續 ========
  const generateComments = async (resume = false) => {
    if (!apiKey || !isValidKey) {
      alert('請輸入有效的 API Key');
      return;
    }

    // 如果不是 resume，就代表是全新開始 -> 將狀態重置
    if (!resume) {
      setCurrentStudentIndex(0);
      setIsPaused(false);
      setIsGenerating(true);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: buildSystemPrompt(commentLength),
    });

    // 用 i = currentStudentIndex 開始，若已經生成到一半就從中斷點繼續
    for (let i = currentStudentIndex; i < students.length; i++) {
      // 在每一輪檢查是否「暫停」
      if (isPaused) {
        // 暫停後，就結束本次生成函式，但不把 isGenerating 改成 false
        // 以便後續可以按「繼續」時再從這邊跳出
        setCurrentStudentIndex(i);
        return;
      }

      let success = false;
      while (!success) {
        try {
          const comment = await generateComment(
            model,
            students[i].name,
            students[i].keywords
          );
          updateStudentComment(i, comment);
          success = true;
          setCurrentStudentIndex(i + 1);
        } catch (error) {
          console.error(
            `生成 ${students[i].name} 的評語失敗，正在重試...`,
            error
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        // 每次生成成功或失敗，都再檢查一次是否暫停
        if (isPaused) {
          setCurrentStudentIndex(i);
          return;
        }
      }
    }

    // 如果迴圈跑完，代表全部生成完成
    setIsGenerating(false);
    setIsPaused(false);
  };

  // 單獨重新生成
  const regenerateSingleComment = async (index) => {
    if (!apiKey || !isValidKey) {
      alert('請輸入有效的 API Key');
      return;
    }
    // 若正在整批生成中，就不允許單獨重生
    if (isGenerating && !isPaused) {
      alert('目前正在生成中，請暫停後再嘗試單獨重生。');
      return;
    }

    try {
      setIsGenerating(true);
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: 'gemini-1.5-flash',
        systemInstruction: buildSystemPrompt(commentLength),
      });

      const comment = await generateComment(
        model,
        students[index].name,
        students[index].keywords
      );
      updateStudentComment(index, comment);
    } catch (error) {
      console.error(`重新生成 ${students[index].name} 的評語失敗`, error);
      alert(`重新生成 ${students[index].name} 的評語失敗，請稍後再試`);
    } finally {
      setIsGenerating(false);
    }
  };

  // 切換「暫停 / 繼續」
  const pauseOrResume = () => {
    // 若本來是暫停 -> 按下後要繼續
    if (isPaused) {
      setIsPaused(false);
      // 此時再呼叫 generateComments(true) 從 currentStudentIndex 繼續跑
      generateComments(true);
    } else {
      // 若本來是執行中 -> 按下後要暫停
      setIsPaused(true);
    }
  };

  // 實際呼叫 API 生成
  const generateComment = async (model, name, keywords) => {
    const chatSession = model.startChat({
      generationConfig: {
        temperature: 1.2,
        topP: 0.95,
        topK: 64,
        maxOutputTokens: 1024,
        responseMimeType: 'text/plain',
      },
      history: [],
    });
    const response = await chatSession.sendMessage(`["${name}", "${keywords}"]`);
    return response.response.text();
  };

  // 更新 comment
  const updateStudentComment = (index, comment) => {
    setStudents((prevStudents) => {
      const newStudents = [...prevStudents];
      newStudents[index].comment = comment;
      return newStudents;
    });
  };

  // 產生 Prompt
  const buildSystemPrompt = (length) => {
    const prompt = prompts[length] || prompts['short']; // 預設使用 short
    return prompt;
  };

  // 下載結果
  const handleFileDownload = () => {
    const worksheetData = students.map((student, idx) => ({
      編號: idx + 1,
      學生姓名: student.name,
      關鍵詞: student.keywords,
      評語: student.comment,
    }));
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Comments');
    const excelBuffer = XLSX.write(workbook, {
      bookType: 'xlsx',
      type: 'array',
    });
    const data = new Blob([excelBuffer], {
      type: 'application/octet-stream',
    });
    saveAs(data, 'output.xlsx');
  };

  // ======== Modal ========
  const openModal = () => {
    setModalIsOpen(true);
  };
  const closeModal = () => {
    setModalIsOpen(false);
  };

  // ======== 拖曳排序 ========
  const handleDragEnd = (result) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    const newStudents = Array.from(students);
    const [removed] = newStudents.splice(result.source.index, 1);
    newStudents.splice(result.destination.index, 0, removed);
    setStudents(newStudents);
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>AI 學期評語生成器</title>
        <link rel="icon" href="/favicon.png" type="image/png" />
        <meta
          name="description"
          content="AI 自動生成學生學期評語的工具，簡單方便，適合教師使用。"
        />
        <meta
          name="keywords"
          content="學期評語生成, 學生評語, 教師工具, AI 評語生成"
        />
      </Head>

      {/* 右上角的按鈕 */}
      <button className={styles.helpButton} onClick={openModal}>
        <FontAwesomeIcon icon={faInfoCircle} /> 使用教學
      </button>

      {/* 教學彈出視窗 */}
      <Modal
        isOpen={modalIsOpen}
        onRequestClose={closeModal}
        contentLabel="使用教學"
        className={styles.modal}
        overlayClassName={styles.overlay}
      >
        <h2>使用教學</h2>
      <button onClick={closeModal} className={styles.closeButton}>
        X
      </button>
      <div className={styles.modalContent}>
        {/* 步驟 1：建立 API Key */}
        <h3>1. 建立 API Key</h3>
        <p>
          先到{' '}
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google AI Studio
          </a>{' '}
          建立 API Key (如下圖)，接著將 API Key 複製然後貼到{' '}
          <a
            href="https://ai-comments.moon-jam.me"
            target="_blank"
            rel="noopener noreferrer"
          >
            網頁
          </a>{' '}
          的框框中，並確認出現 ✅ 圖示，代表 API Key 設定成功 (如果按照下圖無法順利創建，可以參考這個{' '}
          <a
            href="https://youtu.be/ehm3-xoJLsc"
            target="_blank"
            rel="noopener noreferrer"
          >
            影片
          </a>
          )。
        </p>
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/step-1.png"
          alt="Step 1"
          className={styles.image}
        />
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/step-2.png"
          alt="Step 2"
          className={styles.image}
        />
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/step-3.png"
          alt="Step 3"
          className={styles.image}
        />
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/step-4.png"
          alt="Step 4"
          className={styles.image}
        />
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/step-5.png"
          alt="Step 5"
          className={styles.image}
        />

        {/* 方法選擇 */}
        <h3>2. 選擇上傳學生名單的方法</h3>
        <div className={styles.methods}>
          {/* 方法一：上傳 Excel */}
          <details>
            <summary>方法一：上傳已經有學生名單的 Excel</summary>
            <p>
              創建一個 Excel 檔，在 A 欄輸入學生的名字，B 欄輸入學生的幾個特質，類似如下的格式，可以參考{' '}
              <a
                href="https://github.com/moon-jam/AI_Gen_Semester_Comments_Tool/raw/main/sample.xlsx"
                target="_blank"
                rel="noopener noreferrer"
              >
                sample.xlsx
              </a>
              。
            </p>
            <img
              src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/sample_excel.png"
              alt="Sample Excel"
              className={styles.image}
            />
            <p>
              點擊網頁中的 <span className={styles.highlight}>選擇檔案</span> (
              <span className={styles.highlight}>Choose File</span>)，選擇剛剛創建的 Excel 檔。
            </p>
          </details>

          {/* 方法二：直接在網頁上輸入學生名字 */}
          <details>
            <summary>方法二：直接在網頁上輸入學生名字</summary>
            <p>
              先點擊上方的 <span className={styles.highlight}>新增學生</span>，接著輸入學生名字、關鍵字，其中關鍵字可以直接點擊上方的關鍵字列表快速輸入，也可以自己增加常用關鍵字。
            </p>
            <img
              src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/sample_user_input.png"
              alt="Sample User Input"
              className={styles.image}
            />
          </details>
        </div>

        {/* 步驟 3：生成評語 */}
        <h3>3. 選擇評語長度並生成評語</h3>
        <p>
          選擇評語長度，點擊下方的 <span className={styles.highlight}>生成評語</span> 可以一次批量生成所有評語，生成完後點擊{' '}
          <span className={styles.highlight}>下載結果</span>，就完成了！
        </p>
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/process.png"
          alt="Full Process"
          className={styles.image}
        />

        {/* 小技巧 */}
        <h3>小技巧</h3>
        <p>
          如果不想要每次都輸入 API Key，可以在第一次輸入完之後在瀏覽器的上方點擊鑰匙的圖標，按下儲存，下次只要打電腦密碼或指紋辨識就會自動輸入了。
        </p>
        <img
          src="https://raw.githubusercontent.com/moon-jam/AI_Gen_Semester_Comments_Tool/main/assets/save_api_key_tip.png"
          alt="Save API Key Tip"
          className={styles.image}
        />
        </div>
      </Modal>

      <h1 className={styles.title}>AI 學期評語生成器</h1>

      {/* API Key + Eye + 驗證結果 */}
      <div className={styles.apiKeyContainer}>
        <div className={styles.apiKeyWrapper}>
          <input
            type={showApiKey ? 'text' : 'password'}
            placeholder="輸入您的 Gemini API Key"
            value={apiKey}
            onChange={handleApiKeyChange}
            disabled={isGenerating && !isPaused}
            className={styles.input}
          />
          <button
            type="button"
            onClick={toggleShowApiKey}
            className={styles.toggleApiKeyBtn}
          >
            <FontAwesomeIcon icon={showApiKey ? faEyeSlash : faEye} />
          </button>
        </div>
        {isValidKey !== null && (
          <span
            className={`${styles.inputStatus} ${
              isValidKey ? styles.success : styles.error
            }`}
          >
            {isValidKey ? '✅' : '❌'}
          </span>
        )}
      </div>

      {/* 評語長度選擇 */}
      <div className={styles.commentLengthContainer}>
        <label htmlFor="commentLength">選擇評語長度：</label>
        <select
          id="commentLength"
          value={commentLength}
          onChange={(e) => setCommentLength(e.target.value)}
          disabled={!isValidKey || (isGenerating && !isPaused)}
        >
          <option value="short">短評 (2~3 句)</option>
          <option value="medium">中評 (4~5 句)</option>
          <option value="long">長評 (6~8 句)</option>
        </select>
      </div>

      {/* 上傳檔案 */}
      <input
        type="file"
        onChange={handleFileUpload}
        accept=".xlsx, .xls"
        disabled={!isValidKey || (isGenerating && !isPaused)}
        className={styles.uploadButton}
      />

      {/* 新增學生 */}
      <button
        onClick={handleAddStudent}
        disabled={!isValidKey || (isGenerating && !isPaused)}
        className={styles.addButton}
      >
        + 新增學生
      </button>

      {/* 常見特質容器 */}
      <div className={styles.traitsContainer}>
        {commonTraits.map((trait, i) => (
          <button
            key={i}
            type="button"
            className={styles.traitButton}
            onClick={() => handleAddTraitToFocused(trait)}
          >
            {trait}
          </button>
        ))}
        {/* 最後面一個加號，用於新增自訂特質 */}
        <button
          type="button"
          className={styles.addTraitBtn}
          onClick={handleAddCustomTrait}
        >
          <FontAwesomeIcon icon={faPlus} />
        </button>
      </div>

      {/* 表格 (可單獨滾動 + sticky header) */}
      <div className={styles.tableWrapper}>
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="studentsDroppable">
            {(provided) => (
              <table
                className={styles.table}
                {...provided.droppableProps}
                ref={provided.innerRef}
              >
                <thead className={styles.tableHead}>
                  <tr>
                    <th className={styles.th}></th>
                    <th className={styles.th}>編號</th>
                    <th className={styles.th}>學生姓名</th>
                    <th className={styles.th}>關鍵詞</th>
                    <th className={styles.th}>評語</th>
                    <th className={`${styles.th} ${styles.tdOperation}`}>
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => (
                    <Draggable
                      key={`student-${index}`}
                      draggableId={`student-${index}`}
                      index={index}
                    >
                      {(provided2) => (
                        <tr
                          ref={provided2.innerRef}
                          {...provided2.draggableProps}
                          className={styles.trRow}
                        >
                          {/* 拖曳把手 */}
                          <td
                            className={styles.tdHandle}
                            {...provided2.dragHandleProps}
                          >
                            <FontAwesomeIcon icon={faGripVertical} />
                          </td>
                          <td className={styles.td}>
                            {index + 1}
                          </td>
                          <td className={styles.td}>
                            <input
                              type="text"
                              value={student.name}
                              onChange={(e) =>
                                handleEditStudentField(
                                  index,
                                  'name',
                                  e.target.value
                                )
                              }
                              className={styles.tableInput}
                              disabled={isGenerating && !isPaused}
                            />
                          </td>
                          <td className={styles.td}>
                            <textarea
                              value={student.keywords}
                              onChange={(e) =>
                                handleEditStudentField(
                                  index,
                                  'keywords',
                                  e.target.value
                                )
                              }
                              rows={4}
                              className={styles.tableTextarea}
                              disabled={isGenerating && !isPaused}
                              onFocus={() => handleFocusKeywordField(index)}
                            />
                          </td>
                          <td className={styles.td}>
                            <textarea
                              value={student.comment}
                              onChange={(e) =>
                                handleEditStudentField(
                                  index,
                                  'comment',
                                  e.target.value
                                )
                              }
                              rows={4}
                              className={styles.tableTextarea}
                              disabled={isGenerating && !isPaused}
                            />
                          </td>
                          <td className={`${styles.td} ${styles.tdOperation}`}>
                            {/* 改成上下排列 */}
                            <div className={styles.operationBtns}>
                              <button
                                onClick={() => regenerateSingleComment(index)}
                                disabled={isGenerating && !isPaused}
                                className={styles.regenButton}
                              >
                                <FontAwesomeIcon icon={faRedo} /> 重生
                              </button>
                              <button
                                onClick={() => handleDeleteStudent(index)}
                                disabled={isGenerating && !isPaused}
                                className={styles.regenButton}
                                style={{ backgroundColor: '#ff6666' }}
                              >
                                <FontAwesomeIcon icon={faTrash} /> 刪除
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </tbody>
              </table>
            )}
          </Droppable>
        </DragDropContext>
        <div ref={tableEndRef} />
      </div>

      {/* 按鈕群組 */}
      {students.length > 0 && (
        <div className={styles.buttonGroup}>
          {/* 生成 or 繼續按鈕 */}
          {!isGenerating && !isPaused && (
            <button
              onClick={() => generateComments(false)}
              disabled={isGenerating && !isPaused}
              className={styles.button}
            >
              生成評語
            </button>
          )}
          {/* 若正在生成中 (但沒暫停) 顯示暫停；若暫停中顯示繼續 */}
          {isGenerating && (
            <button
              onClick={pauseOrResume}
              className={styles.button}
              style={{ backgroundColor: '#999' }}
            >
              {isPaused ? (
                <>
                  <FontAwesomeIcon icon={faPlay} /> 繼續
                </>
              ) : (
                <>
                  <FontAwesomeIcon icon={faPause} /> 暫停
                </>
              )}
            </button>
          )}

          {/* 若「全部完成」或正在生成中都可以下載。自行決定是否要在生成中禁用。 */}
          <button
            onClick={handleFileDownload}
            disabled={false /* 也可改成 isGenerating && !isPaused */}
            className={styles.button}
          >
            下載結果
          </button>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.copyright}>
          © {copyrightYear}
          <span className={styles.withLove}>
            <FontAwesomeIcon icon={faPaw} />
          </span>
          <span className={styles.author} itemProp="copyrightHolder">
            <a
              href="https://github.com/moon-jam"
              target="_blank"
              rel="noopener noreferrer"
            >
              Moon Jam
            </a>
          </span>
        </div>
        <div className={styles.projectInfo}>
          This project is open-sourced under the MIT license. Visit the
          project at{' '}
          <a
            href="https://github.com/moon-jam/AI_Gen_Semester_Comments_Tool"
            target="_blank"
            rel="noopener noreferrer"
          >
            Here
          </a>
          .
        </div>
      </footer>
    </div>
  );
}

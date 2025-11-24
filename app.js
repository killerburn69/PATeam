const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src/public'));
app.use(express.static(path.join(__dirname, 'src/public')));

const methodOverride = require('method-override');
app.use(methodOverride('_method'));

app.use(session({
  secret: "lssd_secret_2025",
  resave: false,
  saveUninitialized: false,
  cookie: { 
    maxAge: 24 * 60 * 60 * 1000,
    secure: false,              
    httpOnly: true,
    sameSite: 'lax'
  }
}));

const DB_FILE = "./database.json";

const multer = require("multer");
const { v4: uuidv4 } = require("uuid"); // npm install uuid

// Cấu hình multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "src/public/storage/avatars"));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const filename = uuidv4() + ext;
    cb(null, filename);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif/;
    const ext = path.extname(file.originalname).toLowerCase();
    const mimetype = allowed.test(file.mimetype);
    if (mimetype && allowed.test(ext)) {
      return cb(null, true);
    }
    cb(new Error("Chỉ chấp nhận file ảnh JPEG, PNG, GIF"));
  }
});

// ====================== BẢNG LƯƠNG THEO CHỨC VỤ ======================
const SALARY_RATES = {
  "Giám đốc": 50000,
  "Phó Giám đốc": 50000,
  "Trợ lý": 25000,
  "Thư ký": 21500,
  "Trưởng phòng": 18000,
  "Phó phòng": 14500,
  "Cảnh sát viên": 10714
};

const AVAILABLE_RANKS = [
  "Hạ sĩ", "Trung sĩ", "Thượng sĩ", "Thiếu úy", "Trung úy", "Thượng úy", "Đại úy", "Thiếu tá", "Trung tá", "Thượng tá", "Đại tá"
];

function getSalaryRate(position) {
  return SALARY_RATES[position?.trim()] || 10714;
}

// ====================== DATABASE HELPER ======================
function loadDB() {
  if (!fs.existsSync(DB_FILE)) return { users: [] };
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ====================== MIDDLEWARE ======================
function requireAuth(req, res, next) {
  if (req.session.user) return next();
  return res.redirect("/index.html");
}

function requireAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).send("Forbidden");
}

// ====================== ROUTES ======================

// Trang chủ
app.get("/home", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  const page = parseInt(req.query.page) || 1;
  const perPage = 10;
  const totalUsers = db.users.length;
  const totalPages = Math.ceil(totalUsers / perPage);
  const start = (page - 1) * perPage;
  const usersPage = db.users.slice(start, start + perPage);

  res.render('home', {
    displayName: user.displayName,
    position: user.position,
    rank: user.rank,
    avatar: user.avatar,
    role: user.role,
    users: usersPage,
    currentPage: page,
    totalPages: totalPages,
    totalMembers: totalUsers,
    highLevelMembers: db.users.filter(u => u.role === 'admin').length
  });
});

app.get("/attendance", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  const now = new Date();
  const today = now.toLocaleDateString('vi-VN'); // 19/11/2025
  const currentMonthStr = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`; // 11/2025

  // Khởi tạo nếu chưa có
  user.attendance = user.attendance || [];
  user.monthlyHistory = user.monthlyHistory || [];
  user.careerTotal = Number(user.careerTotal) || 0;
  user.salaryRate = Number(user.salaryRate) || 10714;

  // Tính tổng giờ đã hoàn thành hôm nay (chỉ tính ca đã off)
  const todayRecords = user.attendance.filter(a => a.date === today);
  const completedHoursToday = todayRecords
    .filter(r => r.offTime && r.hours !== null)
    .reduce((sum, r) => sum + Number(r.hours || 0), 0);

  const isOnDuty = todayRecords.some(r => !r.offTime);
  const remainingHoursToday = Math.max(0, 4 - completedHoursToday);

  // Tính lương tháng hiện tại từ monthlyHistory (chuẩn nhất)
  const monthEntry = user.monthlyHistory.find(h => h.month === currentMonthStr);
  const monthlySalary = monthEntry ? (Number(monthEntry.salary) || 0) : 0;

  // Gom nhóm theo ngày
  const groupedAttendance = {};
  user.attendance.forEach(record => {
    if (!groupedAttendance[record.date]) groupedAttendance[record.date] = [];
    groupedAttendance[record.date].push(record);
  });

  // Sắp xếp ngày mới nhất lên đầu
  const sortedDates = Object.keys(groupedAttendance).sort((a, b) => {
    const da = a.split('/').reverse().join('/');
    const db = b.split('/').reverse().join('/');
    return db.localeCompare(da);
  });

  const sortedGrouped = {};
  sortedDates.forEach(date => sortedGrouped[date] = groupedAttendance[date]);

  res.render('attendance', {
    displayName: user.displayName,
    position: user.position,
    rank: user.rank,
    avatar: user.avatar,
    role: user.role,

    currentMonth: currentMonthStr,
    monthlySalary: monthlySalary.toLocaleString(),
    salaryRate: user.salaryRate.toLocaleString(),
    careerTotal: user.careerTotal.toLocaleString(),

    isOnDuty,
    todayHours: completedHoursToday.toFixed(2),
    maxDailyHours: 4,
    canCheckIn: remainingHoursToday > 0 && !isOnDuty,

    groupedAttendance: sortedGrouped,
    monthlyHistory: user.monthlyHistory,

    error: req.query.error === 'max_hours' ? 'Bạn đã đủ 4 giờ làm việc hôm nay!' : null
  });
});

// ON / OFF DUTY - PHIÊN BẢN CHUẨN NHẤT 2025 (≥1 tiếng mới tính lương)
app.post("/attendance/check", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.status(403).send("Unauthorized");

  const now = new Date();
  const today = now.toLocaleDateString('vi-VN'); // vd: 19/11/2025
  const time = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dayMonth = today.split('/').slice(0, 2).join('/'); // 19/11

  // Đảm bảo dữ liệu sạch
  user.attendance = user.attendance || [];
  user.monthlyHistory = user.monthlyHistory || [];
  user.careerTotal = Number(user.careerTotal) || 0;
  user.salaryRate = Number(user.salaryRate) || 10714;

  const todayRecords = user.attendance.filter(a => a.date === today);

  // Tính tổng giờ đã HOÀN THÀNH (chỉ tính ca đã off và có giờ hợp lệ)
  const completedHoursToday = todayRecords
    .filter(r => r.offTime && typeof r.hours === 'number' && r.hours > 0)
    .reduce((sum, r) => sum + r.hours, 0);

  const activeSession = todayRecords.find(r => !r.offTime);

  if (activeSession) {
    // ====================== OFF DUTY ======================
    const onTimeStr = activeSession.onTime.split(' - ')[0]; // "14:30:25"
    const [d, m, y] = today.split('/');
    const onDateTime = new Date(`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')} ${onTimeStr}`);

    if (isNaN(onDateTime.getTime())) {
      return res.redirect("/attendance");
    }

    const elapsedHours = (now - onDateTime) / (1000 * 60 * 60); // giờ thực làm

    // CHỈ TÍNH NẾU LÀM ĐỦ ÍT NHẤT 1 TIẾNG (60 phút)
    if (elapsedHours < 1) {
      // Không tính lương, chỉ đóng ca (tránh spam)
      activeSession.offTime = `${time} - ${dayMonth}`;
      activeSession.hours = 0;
      activeSession.salary = 0;
    } else {
      // Tính giờ được cộng (tối đa còn lại trong ngày)
      const maxCanAdd = 4 - completedHoursToday;
      const hoursToAdd = Math.min(elapsedHours, maxCanAdd); // không vượt 4h/ngày
      const finalHours = Math.floor(hoursToAdd * 100) / 100; // làm tròn 2 chữ số
      const salaryEarned = Math.round(finalHours * user.salaryRate * 100) / 100;

      // Cập nhật ca
      activeSession.offTime = `${time} - ${dayMonth}`;
      activeSession.hours = finalHours;
      activeSession.salary = salaryEarned;
      activeSession.status = finalHours >= maxCanAdd ? "Đủ 4 giờ hôm nay" : "Hoàn thành ca";

      // Cộng tổng thu nhập sự nghiệp
      user.careerTotal = Math.round((user.careerTotal + salaryEarned) * 100) / 100;

      // Cập nhật lịch sử tháng
      const monthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
      let monthData = user.monthlyHistory.find(h => h.month === monthKey);
      if (!monthData) {
        monthData = { month: monthKey, hours: 0, salary: 0 };
        user.monthlyHistory.unshift(monthData);
      }
      monthData.hours = Math.round((monthData.hours + finalHours) * 100) / 100;
      monthData.salary = Math.round((monthData.salary + salaryEarned) * 100) / 100;
    }

  } else {
    // ====================== ON DUTY ======================
    if (completedHoursToday >= 4) {
      return res.redirect("/attendance?error=max_hours");
    }

    // Tạo ca mới
    user.attendance.push({
      date: today,
      onTime: `${time} - ${dayMonth}`,
      offTime: null,
      hours: 0,
      salary: 0,
      status: "Đang làm việc"
    });
  }

  saveDB(db);
  res.redirect("/attendance");
});

// Đăng ký người dùng (Admin)
app.post("/register", requireAdmin, (req, res) => {
  const { username, password, displayName, position, rank } = req.body;

  if (!username || !password || !displayName || !position) {
    return res.redirect("/admin?error=missing");
  }

  const db = loadDB();
  if (db.users.some(u => u.username === username)) {
    return res.redirect("/admin?error=exists");
  }

  const salaryRate = getSalaryRate(position);

  const newUser = {
    id: db.users.length + 1,
    username,
    password,
    role: "user",
    displayName,
    position: position.trim(),
    rank: rank?.trim(),
    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(displayName)}&background=random`,
    salaryRate,
    careerTotal: 0,
    attendance: [],
    monthlyHistory: []
  };

  db.users.push(newUser);
  saveDB(db);
  res.redirect("/admin?success=created");
});

// Admin panel (truyền danh sách chức vụ + quân hàm)
app.get("/admin", requireAdmin, (req, res) => {
  res.render('admin', {
    error: req.query.error,
    success: req.query.success,
    positions: Object.keys(SALARY_RATES),
    ranks: AVAILABLE_RANKS
  });
});

// Đăng nhập
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect("/index.html?error=missing");

  const db = loadDB();
  const user = db.users.find(u => u.username === username && u.password === password);
  if (!user) return res.redirect("/index.html?error=invalid");

  req.session.user = { id: user.id, username: user.username, role: user.role };
  res.redirect("/home");
});

// Cài đặt (đổi mật khẩu)
app.get("/settings", requireAuth, (req, res) => {
  res.render('settings', { error: req.query.error, success: req.query.success });
});

app.post("/settings", requireAuth, (req, res) => {
  const { newPassword } = req.body;
  if (!newPassword) return res.redirect("/settings?error=missing");

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (user) {
    user.password = newPassword;
    saveDB(db);
  }
  res.redirect("/settings?success=updated");
});


app.post("/profile/avatar", requireAuth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/");

  if (!req.file) {
    return res.redirect("/profile?error=upload_failed");
  }

  // Xóa ảnh cũ nếu tồn tại và không phải ui-avatars
  if (user.avatar && user.avatar.includes("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  user.avatar = `/storage/avatars/${req.file.filename}`;
  saveDB(db);

  res.redirect("/profile?success=avatar_updated");
});

// === XÓA AVATAR – VỀ MẶC ĐỊNH THEO TÊN HIỆN TẠI (HOÀN HẢO) ===
app.delete("/profile/avatar", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/profile");

  // XÓA FILE ẢNH CŨ TRONG THƯ MỤC
  if (req.file) {
  if (user.avatar && user.avatar.startsWith("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar.split('?')[0]); // bỏ query string nếu có
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.avatar = `/storage/avatars/${req.file.filename}?v=${Date.now()}`; // ← Thêm ?v= để reload ảnh ngay
}

  // TẠO LẠI AVATAR MẶC ĐỊNH THEO TÊN HIỆN TẠI + THÊM TIMESTAMP ĐỂ TRÁNH CACHE
  const nameEncoded = encodeURIComponent(user.displayName.trim());
  const timestamp = Date.now(); // ← Quan trọng! Tránh cache trình duyệt
  user.avatar = `https://ui-avatars.com/api/?name=${nameEncoded}&background=random&bold=true&size=256&format=png&cache=${timestamp}`;

  saveDB(db);
  res.redirect("/profile?success=avatar_deleted");
});

app.post("/profile/update", requireAuth, upload.single("avatar"), (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/");

  const { name_ingame } = req.body;

  // Cập nhật tên trong game (displayName)
  if (name_ingame && name_ingame.trim() !== "" && name_ingame.trim() !== user.displayName) {
    const newName = name_ingame.trim();

    // Kiểm tra trùng tên (khuyến khích, tránh 2 người cùng tên)
    if (db.users.some(u => u.displayName.toLowerCase() === newName.toLowerCase() && u.id !== user.id)) {
      return res.redirect("/profile?error=name_exists");
    }

    user.displayName = newName;

    // Cập nhật lại avatar mặc định nếu đang dùng ui-avatars (tự động theo tên mới)
    if (user.avatar && user.avatar.includes("ui-avatars.com")) {
      user.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(newName)}&background=random&bold=true`;
    }
  }

  // Nếu có upload ảnh mới → cập nhật avatar
  if (req.file) {
  if (user.avatar && user.avatar.startsWith("/storage/avatars/")) {
    const oldPath = path.join(__dirname, "src/public", user.avatar.split('?')[0]); // bỏ query string nếu có
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }
  user.avatar = `/storage/avatars/${req.file.filename}?v=${Date.now()}`; // ← Thêm ?v= để reload ảnh ngay
}

  saveDB(db);
  res.redirect("/profile?success=updated");
});

app.get("/profile", requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.user.id);
  if (!user) return res.redirect("/index.html");

  // Tính tổng lương tháng hiện tại (tháng 11/2025 trở đi)
  const now = new Date();
  const currentMonthKey = `${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
  const currentMonthData = user.monthlyHistory?.find(h => h.month === currentMonthKey);
  const currentMonthSalary = currentMonthData ? Math.round(currentMonthData.salary).toLocaleString() : "0";

  res.render('profile', {
    displayName: user.displayName,
    username: user.username,
    position: user.position || "Cảnh sát viên",
    rank: user.rank || "Hạ sĩ",
    avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName)}&background=random&bold=true`,
    salaryRate: Number(user.salaryRate || 10714).toLocaleString(),
    careerTotal: Number(user.careerTotal || 0).toLocaleString(),

    // Dữ liệu lương tháng
    monthlyHistory: user.monthlyHistory || [],

    // Thông báo
    success: req.query.success,
    error: req.query.error
  });
});

// Đăng xuất
app.post("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/index.html"));
});

// Khởi động server
app.listen(PORT, () => {
  console.log(`PA Timekeeping System chạy tại http://localhost:${PORT}`);
});
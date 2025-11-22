import bcrypt from "bcryptjs";


const passwordHash = await bcrypt.hash("123456", 10);

console.log(passwordHash);
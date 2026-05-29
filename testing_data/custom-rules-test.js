function validateUser(req) {
  // TODO: Implement actual validation logic
  console.log("Validating user:", req.user);
  
  if (!req.user) {
    console.log("User missing, exiting process.");
    process.exit(1);
  }
}

module.exports = { validateUser };

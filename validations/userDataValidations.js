export const validateName = (name) => {
    // Regular expression to match names with uppercase and lowercase letters and allow spaces
    const nameRegex = /^[A-Za-z\s]+$/;
  
    // Check if the name is not empty and matches the regex
    if (name && name.match(nameRegex)) {
      return true; // Name is valid
    } else {
      return false; // Name is invalid
    }
  };
  
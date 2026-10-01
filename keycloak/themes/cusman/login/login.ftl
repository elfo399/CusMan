<#-- Custom Login page for cusman theme using Keycloak v2 layout -->
<#import "template.ftl" as layout>

<@layout.registrationLayout displayInfo=false displayMessage=false; section>
  <#if section == "header">
    <#-- Intentionally left blank: no title outside the card -->
  <#elseif section == "form">
    <#-- Global message (errors, info) -->
    <#if message?has_content>
      <div class="kc-alert kc-alert-${message.type}">${message.summary?no_esc}</div>
    </#if>
<form id="kc-form-login" class="kc-form" action="${url.loginAction}" method="post">
      <input type="hidden" id="id-hidden-input" name="credentialId" value="${(auth.selectedCredential!'' )}">

      <h2 class="kc-card-title">${(realm.displayNameHtml!realm.name)!""?no_esc}</h2>

      <div class="kc-field">
        <label for="username" class="kc-label">${msg("usernameOrEmail")}</label>
        <div class="input-wrap">
          <input tabindex="1"
                 id="username"
                 name="username"
                 type="text"
                 class="input input-email"
                 value="${(login.username!'')}"
                 autocomplete="username"
                 autocapitalize="none"
                 spellcheck="false"
                 aria-invalid="${messagesPerField.existsError('username')?string('true','false')}">
        </div>
        <#if messagesPerField.existsError('username')>
          <span class="field-error" id="input-error-username">${kcSanitize(messagesPerField.get('username'))?no_esc}</span>
        </#if>
      </div>

      <div class="kc-field">
        <label for="password" class="kc-label">${msg("password")}</label>
        <div class="input-wrap">
          <input tabindex="2"
                 id="password"
                 name="password"
                 type="password"
                 class="input input-password"
                 autocomplete="current-password"
                 aria-invalid="${messagesPerField.existsError('password')?string('true','false')}">

          <button type="button"
                  class="input-eye"
                  aria-label="${msg('showPassword')}"
                  aria-controls="password"
                  aria-pressed="false"
                  data-toggle-password
                  data-label-show="${msg('showPassword')}"
                  data-label-hide="${msg('hidePassword')}">
            <img src="${url.resourcesPath}/img/eye.svg" alt="" aria-hidden="true" class="icon-eye">
            <img src="${url.resourcesPath}/img/eye-off.svg" alt="" aria-hidden="true" class="icon-eye-off" hidden>
            <span class="sr-only">${msg('showPassword')}</span>
          </button>
        </div>
        <#if messagesPerField.existsError('password')>
          <span class="field-error" id="input-error-password">${kcSanitize(messagesPerField.get('password'))?no_esc}</span>
        </#if>
      </div>

      <#if realm.rememberMe>
      <div class="kc-options">
        <label class="check">
          <input tabindex="3" type="checkbox" id="rememberMe" name="rememberMe" ${(login.rememberMe?? && login.rememberMe)?string('checked','')}>
          <span>${msg("rememberMe")}</span>
        </label>
      </div>
      </#if>

      <div class="kc-actions">
        <button tabindex="4" type="submit" class="btn-primary" id="kc-login" name="login">${msg("doLogIn")}</button>
      </div>

      <div class="kc-links">
        <#if realm.resetPasswordAllowed>
          <a tabindex="5" href="${url.loginResetCredentialsUrl}">${msg("doForgotPassword")}</a>
        </#if>
      </div>
    </form>
  </#if>
</@layout.registrationLayout>

<script src="${url.resourcesPath}/js/show-password.js"></script>



